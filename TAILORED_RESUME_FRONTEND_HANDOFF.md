# 定制简历前端对接文档

## 结论

当前“定制简历详情页”的权威数据源是：

- `state.tailoredResume`

前端在展示“定制简历详情”时，应直接使用：

```ts
state.tailoredResume
```

来渲染结构化、美观的 HTML 简历页面。

不要把：

```ts
artifacts.tailoredResume.markdown
```

当作详情页主数据源。

---

## 一、后端当前事实

当调用 `prepare_tailored_resume` 后，后端会同时写入两份数据：

1. `state.tailoredResume`
2. `artifacts.tailoredResume`

对应关系如下：

- `state.tailoredResume`
  作用：详情页 / 模板渲染 / 漂亮 HTML 简历页面

- `artifacts.tailoredResume.markdown`
  作用：审查 / 导出 / 兜底纯文本展示

也就是说：

- 详情页请用 `state.tailoredResume`
- Markdown 只作为辅助，不要反向解析它来做详情页

---

## 二、前端详情页应该怎么接

### 主渲染源

请直接消费：

```ts
state.tailoredResume
```

这是模板友好的结构化数据，字段已经按简历模块拆好。

### 推荐渲染模块

详情页正文建议只渲染这些部分：

1. `basics`
2. `summary`
3. `skillGroups`
4. `experience`
5. `projects`
6. `education`
7. `certifications`

不建议把 `additional` 渲染进最终简历模板。

### 章节顺序

章节顺序优先参考：

```ts
state.tailoredResume.templateHints.sectionOrder
```

### 模板提示

模板层可以参考：

```ts
state.tailoredResume.templateHints.variant
state.tailoredResume.templateHints.density
state.tailoredResume.templateHints.pageTarget
```

但这些字段只是渲染提示，不是展示文案。

---

## 三、明确的模板展示要求

### 1. 顶部不要出现无关标签

简历模板顶部不应该出现这些内容：

- “定制简历”
- `Tailored Resume`
- `professional`
- `classic`
- `compact`
- “单页目标”
- “双页目标”
- `1 page target`
- `2 pages target`

这些内容不是简历正文，而是：

- 产品内部标签
- 模板提示信息

前端可以使用它们决定视觉风格，但不要直接渲染给用户。

### 2. 不要渲染“补充信息”这一栏

虽然结构化数据中仍然保留：

```ts
state.tailoredResume.additional
```

但当前产品要求是：

- 简历模板里不展示“补充信息”

所以前端详情页应忽略 `additional` 模块。

### 3. “信息提示”不应出现在正文里

后端结构中有：

- `state.tailoredResume.warnings`
- `state.tailoredResume.missingFacts`

这些内容不是简历正文的一部分。

前端不要把它们渲染成页面底部一个 section。

推荐做法：

- 在 header 区域放一个轻量入口
- 例如提示图标、状态点或小按钮
- 当鼠标悬浮时，显示 `warnings` 和 `missingFacts`
- 如果两者都为空，就不显示这个入口

也就是说：

- 简历正文 = 正式简历内容
- 提示信息 = header 悬浮层

---

## 四、字段使用建议

### `basics`

适合渲染顶部信息区：

- `fullName`
- `headline`
- `email`
- `phone`
- `location`
- `website`
- `linkedin`
- `github`
- `portfolio`

### `summary`

适合渲染个人摘要区：

- `summary.title`
- `summary.lines`

### `skillGroups`

适合渲染为技能分组卡片或标签组：

- `skillGroups[].label`
- `skillGroups[].items`

### `experience`

这是详情页主体，重点渲染：

- `company`
- `title`
- `location`
- `dateLabel`
- `summary`
- `bullets`
- `techStack`

### `projects`

适合作为经历补充区：

- `name`
- `role`
- `dateLabel`
- `summary`
- `bullets`
- `techStack`
- `links`

### `education` / `certifications`

正常按模块渲染即可。

如果为空，前端直接隐藏。

---

## 五、展示层约定

### 1. 所有字段都按纯文本处理

`state.tailoredResume` 中的文本字段应被视为纯文本。

前端不要假设其中包含：

- HTML
- 富文本 AST
- Markdown 标记

因此：

- 不要 `dangerouslySetInnerHTML`
- 前端自己负责排版和样式

### 2. 不要从 Markdown 反解析详情页

错误做法：

- 读取 `artifacts.tailoredResume.markdown`
- 再从中拆标题和列表

正确做法：

- 直接读取 `state.tailoredResume`

### 3. 允许字段缺失

前端应允许这些字段为空或缺失：

- `certifications`
- `projects`
- `summary.title`
- 各类链接字段
- `warnings`
- `missingFacts`

---

## 六、当前前端实现里需要同步调整的地方

当前 Next.js 模板文件是：

- `/Users/yangguang/Desktop/简历/nextjs-ai-elements-starter/src/components/tailored-resume-view.tsx`

按当前代码观察，需要同步调整这些点：

### 1. 去掉顶部无关标签

当前 header 里直接渲染了：

- “定制简历” / `Tailored Resume`
- `pageTarget`
- `variant`

对应大致位置：

- `tailored-resume-view.tsx:471`
- `tailored-resume-view.tsx:475`
- `tailored-resume-view.tsx:484`

这几块都建议移除。

### 2. 不再渲染 `additional`

当前模板里仍然有：

- `case "additional"`

对应大致位置：

- `tailored-resume-view.tsx:678`

建议前端删除这段渲染逻辑，或在 sectionOrder 过滤阶段排除 `additional`。

### 3. 将“信息提示”移到 header 悬浮入口

当前模板把 `warnings + missingFacts` 渲染成正文末尾 section：

- `tailored-resume-view.tsx:699`

这块建议改成：

- header 里的信息提示入口
- hover / popover 展示内容
- 不进入正文内容流

---

## 七、推荐的页面策略

### 1. 详情页

详情页主渲染源：

```ts
state.tailoredResume
```

推荐做法：

- 用结构化字段渲染正式简历页面
- 根据 `templateHints` 决定版式
- 保持打印友好
- 忽略 `additional`
- 不展示 `variant` / `pageTarget` 的字面文案
- 用 header 提示入口承载 `warnings` / `missingFacts`

### 2. 卡片列表

在任务工作台侧边栏或产物卡片里，可以继续使用：

```ts
artifacts.tailoredResume.markdown
```

因为这里只需要：

- 是否生成
- 更新时间
- 简短摘要

### 3. 原文查看 / 导出预览

如果需要“查看 Markdown 原文”能力，可以单独展示：

```ts
artifacts.tailoredResume.markdown
```

但不要让它替代结构化详情页。

---

## 八、最简判断逻辑

```ts
const tailoredResume = state.tailoredResume;

if (tailoredResume) {
  renderPrettyResume(tailoredResume);
} else if (state.artifacts?.tailoredResume?.markdown) {
  renderMarkdownFallback(state.artifacts.tailoredResume.markdown);
} else {
  renderEmptyState();
}
```

---

## 九、最终交付要求

前端在实现“定制简历详情页”时，请遵守这四条：

1. 主数据源使用 `state.tailoredResume`
2. 使用结构化字段渲染漂亮 HTML，而不是解析 Markdown
3. 不展示顶部无关标签，不展示“补充信息”
4. 将 `warnings` / `missingFacts` 放到 header 悬浮提示入口，而不是正文里
