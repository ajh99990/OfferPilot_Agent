# 子 Agent 内容收敛说明

## 目的

当前项目的中间产物曾经偏向“长报告”，用户需要连续阅读多份几千字内容，负担较重。

这次调整的目标是：

- 让 `jobAnalysis` 更像岗位判断卡
- 让 `resumeStrategy` 更像简历改写清单
- 让 `tailoredResume` 更像紧凑可投递简历
- 让 `interviewPack` 更像面试复习卡片
- 让 `critic` 更像审查结论卡

## 变更范围

本次主要修改了两类内容：

1. 子 agent 的 `systemPrompt`
2. `responseFormat` 对应 schema 的 `describe`

没有修改核心字段形状，没有新增或删除前端需要消费的字段。

## 对前端的影响

### 1. 没有破坏性 schema 变更

前端现有字段读取逻辑原则上可以继续使用。

也就是说，这次不是“数据结构升级”，而是“内容密度策略升级”。

### 2. 各产物会变短

前端需要预期：

- summary 类字段会更短
- 列表类字段的条目数会更少
- markdown 会更像简报，而不是长篇正文

### 3. 推荐的展示策略

建议前端同步做这些优化：

- 对 `jobAnalysis` 和 `resumeStrategy` 默认只展示 summary + 关键点列表
- markdown 区域默认折叠，不要默认整页摊开
- 对 `tailoredResume` 和 `interviewPack` 保持完整展示，但避免在页面首屏展开过多低优先级内容
- 对 `warnings` 和 `missingFacts` 使用轻量提示样式，不要渲染成大段说明

## 新的内容密度预期

### `jobAnalysis`

目标：岗位判断卡

建议前端预期：

- `summary` 是一句高密度总结
- `mustHave` 通常 3-5 条
- `niceToHave` 通常 2-3 条
- `risks` 通常 2-3 条
- `hiddenSignals` 通常 0-2 条
- `questionsForUser` 通常 0-3 条
- `markdown` 会明显短于以前

### `resumeStrategy`

目标：简历改写清单

建议前端预期：

- `markdown` 更像短列表，不像长策略文档
- `missingFacts` 通常 0-3 条
- `assumptions` 通常 0-2 条

### `tailoredResume`

目标：紧凑、可投递

建议前端预期：

- `summary.lines` 通常 2-3 条
- `skillGroups` 通常 2-3 组
- `experience` 优先保留最相关的 2-4 段
- 每段 `bullets` 通常 2-4 条
- `projects` 通常 0-2 个
- `warnings` / `missingFacts` 通常不超过 3 条
- `changeSummary` 通常 3-5 条

### `interviewPack`

目标：面试复习卡片

建议前端预期：

- `sellingPoints` 通常 3-5 条
- `likelyQuestions` 通常 5-7 题
- 每题 `answerOutline` 通常 2-4 条
- `questionsToAsk` 通常 3-4 条
- 三版自我介绍都会更短，尤其 `thirtySecond`

### `critic`

目标：审查结论卡

建议前端预期：

- `summary` 是一句话
- `concerns` 通常 1-3 条
- 不再适合按“完整审查报告”来展示

## 前端是否必须改代码

不是必须，但建议同步优化展示方式。

如果前端继续按旧方式把所有 markdown 大段展开，虽然不会报错，但体验提升会打折扣。

更理想的做法是：

- 强化“摘要优先”
- 弱化“长文默认展开”
- 让 `jobAnalysis` / `resumeStrategy` 更像卡片
- 让 `interviewPack` 更像清单

## 结论

这次更新是“内容收敛”，不是“数据结构重构”。

对前端来说，重点不是改类型，而是更新展示预期和信息层级。
