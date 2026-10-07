import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.REGISTER_BASE_PATH || '/',
});
