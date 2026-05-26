/**
 * Browser-side re-export of the security detectors.
 *
 * Single source of truth lives in `api/lib/security.js`. This file simply
 * forwards the exports so the frontend fallback simulation and the Vercel
 * function share identical patterns and behavior.
 *
 * Vite resolves relative imports outside `src/` for plain ESM files. The
 * security module has no Node-specific dependencies (no fs, no path, no process).
 */

export {
  detectTokenFlooding,
  detectPromptInjection,
  detectJailbreak,
  scanDraftForLeakage,
  runSecurityGate,
} from '../../api/lib/security.js'
