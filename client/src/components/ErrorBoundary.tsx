import { Component, type ErrorInfo, type ReactNode } from "react";
import { newReference, reportClientError } from "../lib/errorReporting";
import { Button } from "./ui";

interface Props {
  /** What broke, in the user's words: "the calendar", "this page". */
  area: string;
  children: ReactNode;
  /** Changing this value (e.g. the route) clears the error so navigation always recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
  reference: string;
}

/**
 * Catches errors thrown while rendering its children, so one broken screen does not blank the whole
 * app. It does not see failed requests or errors in click handlers: those are handled where they
 * happen (query error states, toasts).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, reference: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, reference: newReference() };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The reference shown to the person is the one in the server log.
    reportClientError("render", error, this.state.reference);
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty boundary" role="alert">
        <h3>Something went wrong showing {this.props.area}</h3>
        <p>
          Your data is safe. Try again, or go to another page. If it keeps happening, quote reference{" "}
          {this.state.reference}.
        </p>
        <div className="boundary-actions">
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          <Button onClick={() => window.location.assign("/")}>Go to Today</Button>
        </div>
      </div>
    );
  }
}
