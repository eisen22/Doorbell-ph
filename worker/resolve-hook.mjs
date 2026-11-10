// Lets `node test.mjs` load ../src/*.js files that import each other without ".js" (the website's
// bundler and Cloudflare's both allow that; plain Node does not).
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) { if (spec.startsWith('.') && !spec.endsWith('.js')) return next(spec + '.js', ctx); throw e; }
}`));
