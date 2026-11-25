using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace ManageBagle.Api.Infrastructure.Push;

/// <summary>
/// Web Push message encryption (RFC 8291, "aes128gcm" content coding, RFC 8188) and sender
/// identification (VAPID, RFC 8292), on .NET's built-in cryptography — no third-party library
/// (ADR-019). Verified against the worked example in RFC 8291 Appendix A.
/// </summary>
public static class WebPushCrypto
{
    private const int RecordSize = 4096;

    public static string ToBase64Url(ReadOnlySpan<byte> bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] FromBase64Url(string text)
    {
        var s = text.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s.PadRight(s.Length + (4 - s.Length % 4) % 4, '='));
    }

    /// <summary>A P-256 key pair as Web Push uses it: the uncompressed public point (65 bytes) and the private scalar (32 bytes).</summary>
    public static (byte[] PublicKey, byte[] PrivateKey) NewKeyPair()
    {
        using var key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var p = key.ExportParameters(includePrivateParameters: true);
        return (Point(p), p.D!);
    }

    private static byte[] Point(ECParameters p) => [0x04, .. p.Q.X!, .. p.Q.Y!];

    private static ECParameters Parameters(byte[] publicKey, byte[]? privateKey = null)
    {
        if (publicKey.Length != 65 || publicKey[0] != 0x04) throw new ArgumentException("Expected an uncompressed P-256 point.", nameof(publicKey));
        return new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = publicKey[1..33], Y = publicKey[33..] }, D = privateKey };
    }

    /// <summary>Encrypts a payload for one subscription. Salt and sender key are random unless given (tests).</summary>
    public static byte[] Encrypt(byte[] plaintext, byte[] clientPublicKey, byte[] authSecret, byte[]? salt = null, (byte[] Public, byte[] Private)? senderKeys = null)
    {
        salt ??= RandomNumberGenerator.GetBytes(16);
        var (asPublic, asPrivate) = senderKeys ?? NewKeyPair();

        using var sender = ECDiffieHellman.Create(Parameters(asPublic, asPrivate));
        using var client = ECDiffieHellman.Create(Parameters(clientPublicKey));
        var shared = sender.DeriveRawSecretAgreement(client.PublicKey);

        // RFC 8291 §3.3–3.4
        var keyInfo = Concat(Encoding.ASCII.GetBytes("WebPush: info\0"), clientPublicKey, asPublic);
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, authSecret, keyInfo);
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, Encoding.ASCII.GetBytes("Content-Encoding: aes128gcm\0"));
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, Encoding.ASCII.GetBytes("Content-Encoding: nonce\0"));

        // One record: the payload followed by the last-record delimiter (0x02).
        if (plaintext.Length + 1 + 16 > RecordSize) throw new ArgumentException("Payload too large for one record.", nameof(plaintext));
        var padded = Concat(plaintext, [0x02]);
        var ciphertext = new byte[padded.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(cek, 16)) aes.Encrypt(nonce, padded, ciphertext, tag);

        // RFC 8188 header: salt(16) | record size(4) | key id length(1) | key id (the sender's public key)
        var header = new byte[16 + 4 + 1];
        salt.CopyTo(header, 0);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(16), RecordSize);
        header[20] = (byte)asPublic.Length;
        return Concat(header, asPublic, ciphertext, tag);
    }

    /// <summary>The VAPID Authorization header value for one push service (RFC 8292): a 12-hour ES256 token.</summary>
    public static string VapidAuthorization(string endpoint, string subject, byte[] publicKey, byte[] privateKey, DateTimeOffset now)
    {
        var audience = new Uri(endpoint).GetLeftPart(UriPartial.Authority);
        var header = ToBase64Url(JsonSerializer.SerializeToUtf8Bytes(new { typ = "JWT", alg = "ES256" }));
        var claims = ToBase64Url(JsonSerializer.SerializeToUtf8Bytes(new { aud = audience, exp = now.AddHours(12).ToUnixTimeSeconds(), sub = subject }));
        using var key = ECDsa.Create(Parameters(publicKey, privateKey));
        var signature = key.SignData(Encoding.ASCII.GetBytes($"{header}.{claims}"), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
        return $"vapid t={header}.{claims}.{ToBase64Url(signature)}, k={ToBase64Url(publicKey)}";
    }

    private static byte[] Concat(params byte[][] parts)
    {
        var result = new byte[parts.Sum(p => p.Length)];
        var at = 0;
        foreach (var part in parts) { part.CopyTo(result, at); at += part.Length; }
        return result;
    }
}
