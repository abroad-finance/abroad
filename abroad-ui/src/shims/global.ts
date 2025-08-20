// Minimal browser shims for libraries that expect Node-style globals
import { Buffer } from 'buffer';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g: any = globalThis as any;
if (typeof g.global === 'undefined') g.global = g;
if (typeof g.process === 'undefined') g.process = { env: {} };
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
