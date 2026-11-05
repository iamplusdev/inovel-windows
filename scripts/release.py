#!/usr/bin/env python3
"""发布脚本：同步 package.json 版本号、提交、打 v* tag 并推送，由 GitHub Actions 打包发布。

============================================================
使用说明
============================================================
流程（脚本自动完成）：
  1. 安全检查（工作区干净 / 在 main / HEAD 已推送）
  2. 把 package.json 的 version 字段改为发布版本
  3. 提交 "chore(release): vX.Y.Z" 并推送 main
  4. 创建 annotated tag vX.Y.Z 并只推送该 tag

推送 tag 后由 GitHub Actions（.github/workflows/release.yml）自动执行：
  - npm ci + 构建 + electron-builder 打包
  - 创建 GitHub Release，上传 iNovel-{ver}-portable.exe 与 iNovel-{ver}-portable.zip
  - 客户端自动更新功能读取该 Release（electron/updater.ts）

常用命令：
  # 指定版本发布
  python scripts/release.py 1.2.3
  python scripts/release.py v1.2.3

  # 自动递增（默认 patch）
  python scripts/release.py
  python scripts/release.py --bump minor

  # 只预览，不提交/打 tag/推送
  python scripts/release.py --dry-run
  python scripts/release.py --bump minor --dry-run

  # 紧急跳过安全检查（工作区/分支/远端/版本递增）
  python scripts/release.py 1.2.3 --force

参数说明：
  version                      可选，1.2.3 或 v1.2.3；与 --bump 互斥
  --bump {patch,minor,major}   未指定版本时自动递增，默认 patch
  --branch NAME                允许发布的分支，默认 main
  --message TEXT               自定义 tag 说明，默认 "Release vX.Y.Z"
  --dry-run                    只检查并打印将执行的命令
  --force                      跳过工作区/分支/远端/版本递增检查

安全检查：
  - tracked 改动未提交 → 中止
  - 不在指定分支 → 中止
  - HEAD 未推送到 origin/main → 中止
  - 版本不大于最新 tag → 中止
  - 本地/远端已存在同名 tag → 中止
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")


class GitError(RuntimeError):
    pass


def setup_console() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass


def git(args: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    try:
        result = subprocess.run(
            ["git", *args],
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=120,
        )
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {' '.join(args)} 超时") from exc
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise GitError(detail or f"git {' '.join(args)} 失败")
    return result


def repo_root() -> Path:
    return Path(git(["rev-parse", "--show-toplevel"]).stdout.strip())


def parse_version(text: str) -> tuple[int, int, int]:
    m = SEMVER_RE.match((text or "").strip())
    if not m:
        raise ValueError(f"无效版本号：{text}（应为 1.2.3 或 v1.2.3）")
    return int(m.group(1)), int(m.group(2)), int(m.group(3))


def latest_version() -> str | None:
    result = git(["tag", "--list", "v*", "--sort=-v:refname"], check=False)
    for line in result.stdout.splitlines():
        tag = line.strip()
        if SEMVER_RE.match(tag):
            return tag
    return None


def bump_version(latest: str | None, part: str) -> str:
    major, minor, patch = parse_version(latest or "v0.0.0")
    if part == "major":
        major, minor, patch = major + 1, 0, 0
    elif part == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return f"v{major}.{minor}.{patch}"


def remote_branch_sha(branch: str) -> str:
    result = git(["ls-remote", "origin", f"refs/heads/{branch}"], check=False)
    if result.returncode != 0 or not result.stdout.strip():
        raise GitError(f"无法读取 origin/{branch}，请检查网络或 git remote 配置")
    return result.stdout.split()[0]


def actions_url() -> str | None:
    result = git(["remote", "get-url", "origin"], check=False)
    url = result.stdout.strip()
    for pattern in (
        r"git@github\.com:(?P<path>.+?)(?:\.git)?$",
        r"https://github\.com/(?P<path>.+?)(?:\.git)?$",
        r"ssh://git@github\.com/(?P<path>.+?)(?:\.git)?$",
    ):
        m = re.match(pattern, url)
        if m:
            return f"https://github.com/{m.group('path')}/actions"
    return None


def fail(message: str, code: int = 1) -> int:
    print(f"[ERROR] {message}", file=sys.stderr)
    return code


def sync_package_version(root: Path, version_no_v: str) -> None:
    """把 package.json 的 version 字段写为发布版本（保留其余内容与缩进）。"""
    pkg_path = root / "package.json"
    if not pkg_path.exists():
        raise GitError("未找到 package.json")
    raw = pkg_path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if data.get("version") == version_no_v:
        print(f"package.json 版本已是 {version_no_v}，无需修改")
        return
    data["version"] = version_no_v
    pkg_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"package.json version -> {version_no_v}")


def main() -> int:
    setup_console()
    parser = argparse.ArgumentParser(
        description="同步版本号、打 tag 并推送，由 GitHub Actions 打包并创建 GitHub Release。",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  python scripts/release.py 1.2.3\n"
            "  python scripts/release.py                  # 默认 patch 递增\n"
            "  python scripts/release.py --bump minor --dry-run\n"
        ),
    )
    parser.add_argument("version", nargs="?", help="发布版本，如 1.2.3 或 v1.2.3")
    parser.add_argument(
        "--bump", choices=["patch", "minor", "major"], help="未指定版本号时自动递增；默认 patch"
    )
    parser.add_argument("--branch", default="main", help="允许发布的分支（默认 main）")
    parser.add_argument("--message", help="tag 说明（默认 Release vX.Y.Z）")
    parser.add_argument("--dry-run", action="store_true", help="只检查并打印，不修改/推送")
    parser.add_argument(
        "--force", action="store_true", help="跳过工作区/分支/远端/版本递增检查（紧急发布用）"
    )
    args = parser.parse_args()

    if args.version and args.bump:
        return fail("不能同时指定版本号和 --bump", 2)

    try:
        root = repo_root()
    except GitError as exc:
        return fail(f"当前目录不是 git 仓库：{exc}")
    os.chdir(root)

    # 1) 安全检查
    if not args.force:
        dirty = git(["status", "--porcelain", "--untracked-files=no"]).stdout.strip()
        if dirty:
            print("[ERROR] 存在未提交的 tracked 改动，请先 commit 并 push：", file=sys.stderr)
            print(dirty, file=sys.stderr)
            print("       仅演练可加 --dry-run --force", file=sys.stderr)
            return 1

        branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
        if branch != args.branch:
            return fail(f"当前分支为 {branch}，发布需在 {args.branch}（或用 --branch 指定）")

        try:
            remote_sha = remote_branch_sha(args.branch)
            ancestor = git(["merge-base", "--is-ancestor", "HEAD", remote_sha], check=False)
        except GitError as exc:
            return fail(str(exc))
        if ancestor.returncode != 0:
            return fail(
                f"当前 HEAD 未包含在 origin/{args.branch}，请先执行 git push origin {args.branch}"
            )

    # 2) 计算版本
    if not args.force:
        fetched = git(["fetch", "--tags", "--quiet", "origin"], check=False)
        if fetched.returncode != 0:
            print("[WARN] 拉取远端 tags 失败，版本判断可能不准确", file=sys.stderr)

    latest = latest_version()
    if args.version:
        version = args.version if args.version.startswith("v") else f"v{args.version}"
        try:
            new_tuple = parse_version(version)
        except ValueError as exc:
            return fail(str(exc), 2)
    else:
        version = bump_version(latest, args.bump or "patch")
        new_tuple = parse_version(version)

    if latest and not args.force and new_tuple <= parse_version(latest):
        return fail(f"版本必须大于最新 tag {latest}（当前 {version}）")

    local_tag = git(["rev-parse", "-q", "--verify", f"refs/tags/{version}"], check=False)
    if local_tag.returncode == 0:
        return fail(f"本地已存在 tag {version}")

    if not args.force:
        remote_tag = git(["ls-remote", "--tags", "origin", f"refs/tags/{version}"], check=False)
        if remote_tag.stdout.strip():
            return fail(f"远端已存在 tag {version}")

    version_no_v = version[1:]
    print(f"最新 tag : {latest or '（无）'}")
    print(f"发布版本 : {version}")

    # 3) 版本号预览（dry-run 只读不写）
    pkg_path = root / "package.json"
    if not pkg_path.exists():
        return fail("未找到 package.json")
    try:
        current_version = json.loads(pkg_path.read_text(encoding="utf-8")).get("version", "")
    except (OSError, ValueError) as exc:
        return fail(f"读取 package.json 失败：{exc}")
    if current_version != version_no_v:
        print(f"将修改 package.json version: {current_version} -> {version_no_v}")
    else:
        print("package.json 版本已是发布版本，发布时不会产生提交")

    message = args.message or f"Release {version}"
    print(f"[1/3] git add package.json && git commit -m 'chore(release): {version}'")
    print(f"[2/3] git push origin {args.branch}")
    print(f"[3/3] git tag -a {version} -m '{message}' && git push origin refs/tags/{version}")

    if args.dry_run:
        print("[dry-run] 未提交/打 tag/推送")
        return 0

    try:
        sync_package_version(root, version_no_v)
        git(["add", "package.json"])
        commit_needed = git(["status", "--porcelain", "package.json"]).stdout.strip()
        if commit_needed:
            git(["commit", "-m", f"chore(release): {version}"])
        else:
            print("package.json 无变化，跳过提交")
    except GitError as exc:
        return fail(f"提交版本号失败：{exc}")

    pushed_main = git(["push", "origin", args.branch], check=False)
    if pushed_main.returncode != 0:
        detail = (pushed_main.stderr or pushed_main.stdout).strip()
        return fail(f"推送 main 失败：{detail}")

    try:
        git(["tag", "-a", version, "-m", message])
    except GitError as exc:
        return fail(f"创建 tag 失败：{exc}")

    pushed_tag = git(["push", "origin", f"refs/tags/{version}"], check=False)
    if pushed_tag.returncode != 0:
        detail = (pushed_tag.stderr or pushed_tag.stdout).strip()
        print(f"[ERROR] 推送 tag 失败：{detail}", file=sys.stderr)
        print(
            f"        本地 tag 已创建；修复后重试：git push origin refs/tags/{version}",
            file=sys.stderr,
        )
        print(f"        如需删除后重来：git tag -d {version}", file=sys.stderr)
        return 1

    print(f"[OK] 已推送 tag {version}，CI 将打包 exe+zip 并创建 GitHub Release")
    url = actions_url()
    if url:
        print(f"查看进度：{url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
