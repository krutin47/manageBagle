using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ManageBagle.Api.Infrastructure.Push;

namespace ManageBagle.Api.Tests;

public class WebPushCryptoTests
{
    private static byte[] B(string s) => WebPushCrypto.FromBase64Url(s);

    /// <summary>The worked example in RFC 8291, Appendix A, byte for byte.</summary>
    [Fact]
    public void Encryption_matches_the_RFC_8291_example()
    {
        var body = WebPushCrypto.Encrypt(
            Encoding.UTF8.GetBytes("When I grow up, I want to be a watermelon"),
            clientPublicKey: B("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
            authSecret: B("BTBZMqHH6r4Tts7J_aSIgg"),
            salt: B("DGv6ra1nlYgDCS1FRnbzlw"),
            senderKeys: (B("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"), B("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")));

        Assert.Equal(
            "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
            WebPushCrypto.ToBase64Url(body));
    }

    [Fact]
    public void The_sender_token_is_a_valid_ES256_signature_for_the_push_service_origin()
    {
        var (pub, priv) = WebPushCrypto.NewKeyPair();
        var now = DateTimeOffset.UtcNow;
        var header = WebPushCrypto.VapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", "https://app.example.com", pub, priv, now);

        var token = header["vapid t=".Length..header.IndexOf(", k=", StringComparison.Ordinal)];
        Assert.EndsWith($"k={WebPushCrypto.ToBase64Url(pub)}", header);
        var parts = token.Split('.');
        var claims = JsonDocument.Parse(WebPushCrypto.FromBase64Url(parts[1])).RootElement;
        Assert.Equal("https://fcm.googleapis.com", claims.GetProperty("aud").GetString());
        Assert.Equal("https://app.example.com", claims.GetProperty("sub").GetString());
        Assert.InRange(claims.GetProperty("exp").GetInt64() - now.ToUnixTimeSeconds(), 11 * 3600, 12 * 3600);

        using var verifier = ECDsa.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = pub[1..33], Y = pub[33..] } });
        Assert.True(verifier.VerifyData(Encoding.ASCII.GetBytes($"{parts[0]}.{parts[1]}"), WebPushCrypto.FromBase64Url(parts[2]), HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation));
    }
}
