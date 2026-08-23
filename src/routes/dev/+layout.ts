// Dev-only routes — no SSR, but must be prerenderable for adapter-static.
// In production builds `import.meta.env.DEV` is false, so these pages render as
// empty shells; their `onMount` guard redirects to /home/overview at runtime.
export const prerender = true;
export const ssr = false;
