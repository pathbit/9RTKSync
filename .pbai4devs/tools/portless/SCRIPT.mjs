#!/usr/bin/env node
import { main } from '../../scripts/preparar-ferramentas/SCRIPT.mjs';

try { process.exitCode = await main(['--tool', "portless", ...process.argv.slice(2)]); }
catch (error) { console.error(error.message); process.exitCode = 1; }
