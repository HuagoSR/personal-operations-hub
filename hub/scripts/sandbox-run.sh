#!/usr/bin/env bash
# Enforcement runner (Phase 4 阶段五): run a worker command inside bwrap sandbox.
#
# 设计：
#   - 整进程 bwrap：仅挂载系统目录(ro) + 授权 workspace(rw) + 私有 HOME(rw)；
#     宿主 home 内容（.ssh/.codex/.opencode/微信/Hub 数据）不可见
#   - network 三档：
#       allow       → 共享网络
#       deny        → 整进程 --unshare-net（含模型调用，全离线）
#       command-deny→ 进程保留网络（模型 API 可用），/bin/bash 被包装器替换：
#                     每个 bash 子命令在嵌套 --unshare-net bwrap 中执行（命令级硬断网）
#   - sudo/su 二进制以空文件屏蔽；/etc 只读 → 无提权路径
#   - 凭据只经 --env 注入（API key 等），宿主凭据文件不挂载
#
# 用法: sandbox-run.sh --workspace DIR --home DIR --network allow|deny|command-deny [--env K=V]... -- CMD...

set -e
WORKSPACE=""
HOME_DIR=""
NETWORK="allow"
ENVS=()
CMD=()
MODE=""
for arg in "$@"; do
  case "$MODE" in
    workspace) WORKSPACE="$arg"; MODE="";;
    home) HOME_DIR="$arg"; MODE="";;
    network) NETWORK="$arg"; MODE="";;
    env) ENVS+=("$arg"); MODE="";;
    cmd) CMD+=("$arg");;
    "")
      case "$arg" in
        --workspace) MODE="workspace";;
        --home) MODE="home";;
        --network) MODE="network";;
        --env) MODE="env";;
        --) MODE="cmd";;
        *) echo "unknown arg: $arg" >&2; exit 2;;
      esac;;
  esac
done

[ -n "$WORKSPACE" ] && [ -n "$HOME_DIR" ] && [ ${#CMD[@]} -gt 0 ] || { echo "usage: sandbox-run.sh --workspace DIR --home DIR --network allow|deny|command-deny [--env K=V]... -- CMD..." >&2; exit 2; }
WORKSPACE=$(realpath "$WORKSPACE")
mkdir -p "$HOME_DIR"
HOME_DIR=$(realpath "$HOME_DIR")
RUNTIME=$(mktemp -d)
cleanup() { rm -rf "$RUNTIME"; }
trap cleanup EXIT

BWRAP_ARGS=(--unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup)

if [ "$NETWORK" = "deny" ]; then
  BWRAP_ARGS+=(--unshare-net)
fi

for d in /usr /bin /lib /lib64 /etc; do
  [ -d "$d" ] && BWRAP_ARGS+=(--ro-bind "$d" "$d")
done
BWRAP_ARGS+=(--proc /proc --dev /dev --tmpfs /tmp)
BWRAP_ARGS+=(--bind "$HOME_DIR" "$HOME_DIR" --setenv HOME "$HOME_DIR")

if [ "$NETWORK" = "command-deny" ]; then
  mkdir -p "$HOME_DIR/.sandbox"
  REAL_BASH=$(readlink -f /bin/bash)
  cp "$REAL_BASH" "$HOME_DIR/.sandbox/real-bash"
  cat > "$RUNTIME/bash-wrapper" <<WRAPEOF
#!/bin/sh
exec /usr/bin/bwrap --unshare-all --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --bind "$WORKSPACE" "$WORKSPACE" \
  --bind "$HOME_DIR" "$HOME_DIR" \
  --chdir "$WORKSPACE" \
  --die-with-parent -- "$HOME_DIR/.sandbox/real-bash" "\$@"
WRAPEOF
  chmod +x "$RUNTIME/bash-wrapper"
  BWRAP_ARGS+=(--bind "$RUNTIME/bash-wrapper" /bin/bash)
fi

# 屏蔽提权二进制
for f in /usr/bin/sudo /usr/bin/su /usr/bin/pkexec; do
  [ -e "$f" ] && BWRAP_ARGS+=(--bind /dev/null "$f")
done

# 授权 workspace（rw）
BWRAP_ARGS+=(--bind "$WORKSPACE" "$WORKSPACE" --chdir "$WORKSPACE")

BWRAP_ARGS+=(--clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8")
for e in "${ENVS[@]}"; do
  NAME="${e%%=*}"
  VALUE="${e#*=}"
  BWRAP_ARGS+=(--setenv "$NAME" "$VALUE")
done

exec bwrap "${BWRAP_ARGS[@]}" --die-with-parent -- "${CMD[@]}"
