export function createHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    h = (h << 5) - h + char;
    h = h & h;
  }
  return h.toString(16).padStart(16, '0');
}
