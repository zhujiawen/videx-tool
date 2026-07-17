const { execFile: defaultExecFile } = require('node:child_process');

function checkRuntimeDependencies(options = {}) {
  const pythonBin = options.pythonBin || process.env.PYTHON_BIN || 'python3';
  const execFile = options.execFile || defaultExecFile;
  return new Promise((resolve, reject) => {
    execFile(pythonBin, ['-m', 'yt_dlp', '--version'], { timeout: 10_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`yt-dlp is unavailable via ${pythonBin}: ${(stderr || error.message).trim()}`));
        return;
      }
      resolve({ pythonBin, ytDlpVersion: stdout.trim() });
    });
  });
}

module.exports = { checkRuntimeDependencies };
