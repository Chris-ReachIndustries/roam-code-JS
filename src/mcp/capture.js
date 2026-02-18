/**
 * Capture all console output and intercept process.exit during an async function.
 * Returns the captured text.
 *
 * Extracted to its own module so tests can import it without pulling in the MCP SDK.
 */
export async function captureOutput(fn) {
  const chunks = [];
  const origLog = console.log;
  const origError = console.error;
  const origWarn = console.warn;
  const origExit = process.exit;

  console.log = (...args) => chunks.push(args.map(String).join(' '));
  console.error = (...args) => chunks.push(args.map(String).join(' '));
  console.warn = (...args) => chunks.push(args.map(String).join(' '));
  process.exit = (code) => {
    throw new Error(`process.exit(${code}) intercepted`);
  };

  try {
    await fn();
  } catch (err) {
    if (!err.message?.includes('process.exit')) {
      chunks.push(`Error: ${err.message}`);
    }
  } finally {
    console.log = origLog;
    console.error = origError;
    console.warn = origWarn;
    process.exit = origExit;
  }

  return chunks.join('\n');
}
