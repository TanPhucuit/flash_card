// Ambient module for Vite's `?url` import suffix, used to get a hashed asset
// URL for the pdf.js worker script without a full `vite/client` types pull-in.
declare module "*?url" {
  const url: string;
  export default url;
}
