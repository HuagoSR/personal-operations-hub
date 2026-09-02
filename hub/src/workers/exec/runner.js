'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function buildBwrapArgs(opts) {
  const {
    workspace, homeDir, network, rootDir, extraRoBinds = [],
  } = opts;
  const runtime = fs.mkdtempSync(path.join(rootDir || os.tmpdir(), 'hub-exec-'));
  const args = ['--unshare-user', '--unshare-ipc', '--unshare-pid', '--unshare-uts', '--unshare-cgroup'];
  if (network === 'deny') args.push('--unshare-net');

  for (const d of ['/usr', '/bin', '/lib', '/lib64', '/etc']) {
    if (fs.existsSync(d)) args.push('--ro-bind', d, d);
  }
  args.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');
  args.push('--bind', homeDir, homeDir, '--setenv', 'HOME', homeDir);

  if (network === 'command-deny') {
    const sbDir = path.join(homeDir, '.sandbox');
    fs.mkdirSync(sbDir, { recursive: true });
    const realBash = fs.realpathSync('/bin/bash');
    fs.copyFileSync(realBash, path.join(sbDir, 'real-bash'));
    const wrapper = path.join(runtime, 'bash-wrapper');
    fs.writeFileSync(wrapper, `#!/bin/sh
exec /usr/bin/bwrap --unshare-all --proc /proc --dev /dev --tmpfs /tmp \\
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \\
  --bind "${workspace}" "${workspace}" --bind "${homeDir}" "${homeDir}" \\
  --chdir "${workspace}" --die-with-parent -- "${path.join(sbDir, 'real-bash')}" "$@"
`);
    fs.chmodSync(wrapper, 0o755);
    args.push('--bind', wrapper, '/bin/bash');
  }

  for (const f of ['/usr/bin/sudo', '/usr/bin/su', '/usr/bin/pkexec']) {
    if (fs.existsSync(f)) args.push('--bind', '/dev/null', f);
  }

  for (const [src, dst] of extraRoBinds) args.push('--ro-bind', src, dst);

  args.push('--bind', workspace, workspace, '--chdir', workspace);

  return { args, runtime };
}

function runSandboxed(opts, command, spawnOpts = {}) {
  const { args, runtime } = buildBwrapArgs(opts);
  const envMap = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'C.UTF-8',
    HOME: opts.homeDir,
  };
  for (const e of opts.env || []) {
    const idx = e.indexOf('=');
    if (idx > 0) envMap[e.slice(0, idx)] = e.slice(idx + 1);
  }
  const child = spawn('/usr/bin/bwrap', [...args, '--die-with-parent', '--', ...command], {
    ...spawnOpts,
    env: { ...envMap, ...(spawnOpts.env || {}) },
  });
  const cleanup = () => {
    try { fs.rmSync(runtime, { recursive: true, force: true }); } catch (e) { }
  };
  child.on('exit', cleanup);
  child.on('error', cleanup);
  return child;
}

function runSandboxedCapture(opts, command, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const child = runSandboxed(opts, command, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    const t = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { }
      finish({ ok: false, code: null, stdout: out, stderr: err, timeout: true });
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('exit', (code) => { clearTimeout(t); finish({ ok: code === 0, code, stdout: out, stderr: err }); });
    child.on('error', (e) => { clearTimeout(t); finish({ ok: false, code: null, stdout: out, stderr: String(e) }); });
  });
}

module.exports = { buildBwrapArgs, runSandboxed, runSandboxedCapture };
