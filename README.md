# acl4ssr-override

**Subconverter 风格 INI → Stash / Mihomo Party 覆写**

每次生成会拉取上游最新 INI（默认：全部 [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) 官方 `Clash/config/*.ini`），解析后自适应输出：

| 产物 | 路径 |
|------|------|
| Stash | `output/<profile_id>/stash/override.stoverride` |
| Mihomo Party | `output/<profile_id>/party/override.js` |
| 原始 INI 快照 | `output/<profile_id>/upstream.ini` |
| 索引 | `output/index.json` |

不是手写第二份规则，而是 **INI→覆写转换器**；上游增删策略组/规则集会在下次 `generate` 时自动跟上。

---

## 快速使用

### Stash

1. 配置 → 覆写 → 从 URL 下载，例如 Full：

```text
https://raw.githubusercontent.com/FlyRenxing/acl4ssr-override/main/output/online_full/stash/override.stoverride
```

2. 启用该覆写，更新配置。  
3. 若还有 Tailscale / 家庭局域网等私有覆写，**放在本覆写之后**（Stash 自上而下应用；本文件对 `rules` 使用 `#!replace`）。

### Mihomo Party

覆写页面导入：

```text
https://raw.githubusercontent.com/FlyRenxing/acl4ssr-override/main/output/online_full/party/override.js
```

订阅 → 编辑信息 → 选择该覆写。

仓库：https://github.com/FlyRenxing/acl4ssr-override

### 常用 profile id

| id | 上游 INI |
|----|----------|
| `online_full` | `ACL4SSR_Online_Full.ini` |
| `online_mini` | `ACL4SSR_Online_Mini.ini` |
| `online_full_adblock_plus` | `ACL4SSR_Online_Full_AdblockPlus.ini` |
| `online_mini_ai` | `ACL4SSR_Online_Mini_Ai.ini` |
| … | 见 `config/acl4ssr-catalog.yaml` / `output/index.json` |

完整列表生成后见 `output/index.json`。

---

## 本地开发

```bash
npm install
npm test
npm run generate                 # 拉取全部官方 INI 并生成
npm run generate -- --only online_full,online_mini
npm run generate -- --offline    # 使用 .cache
npm run generate -- --strict     # 任一 profile 失败则 exit 1
npm run catalog:check            # 检查官方是否新增 ini
```

---

## 配置

### `config/profiles.yaml`

- `defaults`：DNS、exclude_remarks、adapt 选项、产物 targets  
- `presets.acl4ssr`：展开 `acl4ssr-catalog.yaml` 全部官方模板  
- `profiles`：可追加 **任意** subconverter INI：

```yaml
profiles:
  - id: my_fork
    name: My Fork
    ini_url: https://example.com/path/custom.ini
    enabled: true
```

### `config/acl4ssr-catalog.yaml`

官方 ini 文件名清单。上游新增文件时更新此列表（或跑 `catalog:check`）。

---

## 架构

```text
fetch INI → parseIni (通用 subconverter) → adapt (无业务组名硬编码)
         → validate → emit stash / party → output/<id>/
```

| 模块 | 职责 |
|------|------|
| `parse-ini.mjs` | `ruleset=` / `custom_proxy_group=` |
| `adapt.mjs` | `[]FINAL`→`MATCH`、本地 `rules/ACL4SSR/`→raw URL、`include-all`+exclude |
| `emit/stash.mjs` | `#!replace` 全量覆写 |
| `emit/party.mjs` | `function main(config)` |

本地路径规则（非 Online 模板）：

`rules/ACL4SSR/Clash/Foo.list` →  
`https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/Foo.list`

---

## CI

| Workflow | 触发 | 作用 |
|----------|------|------|
| `generate overrides` | 每天 16:00 UTC、改 `config/`/`scripts/`、手动 | `npm test` + 全量 generate，有变更则提交 `output/` |
| `catalog check` | 每周一、改 catalog、手动 | 对比官方是否新增 ini |

首次启用 workflow 文件需要本机 `gh` 带 `workflow` scope（一次性）：

```bash
gh auth refresh -h github.com -s workflow
cd ~/repos/acl4ssr-override && git push origin main
```

推送后可在 Actions 页手动 **Run workflow** 验证。

Stash raw 示例（已在 main）：

```text
https://raw.githubusercontent.com/FlyRenxing/acl4ssr-override/main/output/online_full/stash/override.stoverride
```

---

## 与 Tailscale 私有覆写

本仓可公开。含密钥的 Tailscale 覆写请继续放在私有仓（如 `stash-overrides`），在 Stash 中 **叠在本覆写之后**，且不要对已 `#!replace` 的整段 rules 再 replace 掉（只追加节点/局域网规则即可）。

---

## License

规则内容版权归 [ACL4SSR](https://github.com/ACL4SSR/ACL4SSR) 等上游；本仓库转换器代码以 MIT 许可（见需要时可补 `LICENSE`）。
