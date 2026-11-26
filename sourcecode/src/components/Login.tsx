import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LogIn } from 'lucide-react';

export const Login: React.FC = () => {
  const { login } = useAuth();

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <LogIn className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to ImpactLens AI</h1>
        <p className="text-gray-600 mb-8">
          Transform raw data into intelligence using natural language.
        </p>
        <button
          onClick={login}
          className="w-full flex items-center justify-center gap-3 bg-white border border-gray-300 text-gray-700 font-medium py-3 px-4 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
};
