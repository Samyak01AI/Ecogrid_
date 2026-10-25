import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, XCircle, ChevronDown, ShieldAlert } from 'lucide-react';

export interface FullscreenErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
  onRetry?: () => void;
  panelName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * Strips sensitive credentials, tokens, and authorization strings from error messages
 * and stack traces before displaying in the technical details disclosure.
 */
export function sanitizeErrorMessage(raw: string): string {
  if (!raw) return 'Unknown error occurred.';
  return raw
    .replace(/(?:xai-|grok-|Bearer\s+|api[_-]?key[=:\s]+)[a-zA-Z0-9_\-\.]{8,}/gi, '[REDACTED_SECRET]')
    .replace(/password[=:\s]+[^\s&]+/gi, 'password=[REDACTED]')
    .replace(/token[=:\s]+[^\s&]+/gi, 'token=[REDACTED]');
}

export class FullscreenErrorBoundary extends Component<FullscreenErrorBoundaryProps, State> {
  constructor(props: FullscreenErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    // Structured diagnostic logging for development without exposing secrets
    console.error('[EcoGrid AI] Fullscreen panel caught rendering error:', {
      panel: this.props.panelName ?? 'Unknown Panel',
      name: error.name,
      message: sanitizeErrorMessage(error.message),
      componentStack: errorInfo.componentStack ? sanitizeErrorMessage(errorInfo.componentStack.slice(0, 400)) : undefined,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onRetry?.();
  };

  private handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle ?? `${this.props.panelName ? `${this.props.panelName} ` : ''}Plan View Alert`;
      const message =
        this.props.fallbackMessage ??
        'Adaptive optimization could not be completed or rendered. Your existing plan and active map remain unchanged. Review the error or retry.';

      const sanitizedMsg = this.state.error?.message
        ? sanitizeErrorMessage(this.state.error.message)
        : 'An unexpected rendering issue occurred.';

      const sanitizedStack = this.state.errorInfo?.componentStack
        ? sanitizeErrorMessage(this.state.errorInfo.componentStack.trim())
        : this.state.error?.stack
        ? sanitizeErrorMessage(this.state.error.stack.split('\n').slice(0, 5).join('\n'))
        : null;

      return (
        <div className="fullscreen-panel-error-container" role="alert" aria-live="assertive">
          <div className="fullscreen-panel-error-card">
            <div className="error-card-header">
              <div className="error-icon-box">
                <AlertTriangle size={20} className="error-alert-icon" />
              </div>
              <div className="error-card-titles">
                <span className="error-card-kicker">NON-DESTRUCTIVE RECOVERY</span>
                <h3 className="error-card-title">{title}</h3>
              </div>
            </div>

            <p className="error-card-message">{message}</p>

            <div className="error-card-safety-notice">
              <ShieldAlert size={14} className="safety-icon" />
              <span>Map view, geographic grid (100 cells), and stored scenario data are intact and interactive.</span>
            </div>

            <div className="error-card-actions">
              <button
                type="button"
                className="button button-accent error-retry-btn"
                onClick={this.handleRetry}
              >
                <RefreshCw size={14} />
                <span>Retry</span>
              </button>
              <button
                type="button"
                className="button button-quiet error-dismiss-btn"
                onClick={this.handleDismiss}
              >
                <XCircle size={14} />
                <span>Dismiss</span>
              </button>
            </div>

            <details className="error-technical-details">
              <summary>
                <span>Technical Diagnostics</span>
                <ChevronDown size={13} className="details-arrow" />
              </summary>
              <div className="technical-details-content">
                <div className="tech-item">
                  <strong>Exception:</strong> <code>{sanitizedMsg}</code>
                </div>
                {sanitizedStack && (
                  <div className="tech-item">
                    <strong>Component Trace:</strong>
                    <pre className="stack-trace-box">{sanitizedStack}</pre>
                  </div>
                )}
                <div className="tech-hint">
                  No sensitive tokens, Grok API keys, or municipal passwords are shown.
                </div>
              </div>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
