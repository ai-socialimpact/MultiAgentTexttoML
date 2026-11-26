import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const geminiKey = process.env.GEMINI_DEFAULT_API_KEY || env.GEMINI_DEFAULT_API_KEY || '';
  const openaiKey = process.env.OPENAI_DEFAULT_API_KEY || env.OPENAI_DEFAULT_API_KEY || '';
  const claudeKey = process.env.CLAUDE_DEFAULT_API_KEY || env.CLAUDE_DEFAULT_API_KEY || process.env.ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY || '';

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_DEFAULT_API_KEY': JSON.stringify(geminiKey),
      'process.env.OPENAI_DEFAULT_API_KEY': JSON.stringify(openaiKey),
      'process.env.CLAUDE_DEFAULT_API_KEY': JSON.stringify(claudeKey),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(claudeKey),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
