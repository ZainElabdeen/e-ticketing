import { z } from 'zod';

// Zod 4 probes `new Function` when a schema is built; a CSP without 'unsafe-eval' logs an error.
// Import this module first so the flag is set before any schema is constructed.
z.config({ jitless: true });
