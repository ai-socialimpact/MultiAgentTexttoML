import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      
      let errorMessage = this.state.error?.message || 'An unexpected error occurred';
      let isFirestoreError = false;
      try {
        const parsed = JSON.parse(errorMessage);
        if (parsed.operationType) {
          isFirestoreError = true;
          errorMessage = `Database Error (${parsed.operationType} on ${parsed.path}): ${parsed.error}`;
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 border border-red-100">
            <h2 className="text-xl font-semibold text-red-600 mb-4">Something went wrong</h2>
            <div className="bg-red-50 p-4 rounded-md overflow-auto max-h-64 text-sm text-red-800 font-mono">
              {errorMessage}
            </div>
            <button
              className="mt-6 w-full bg-red-600 text-white py-2 px-4 rounded-md hover:bg-red-700 transition-colors"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
