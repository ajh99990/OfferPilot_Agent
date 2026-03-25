# Simple Binary HITL 兼容说明

这份文档保留给前端联调使用，但当前实现已经不再单独维护 `simple_binary_confirmation_card`。

## 当前结论

`request_simple_human_confirmation` 这个测试工具现在已经复用统一的：

- `ui = "approval_card"`

也就是说，前端不需要再单独维护一套“简单二元确认卡片”组件。

## 当前 payload 形状

它仍然是最简单的二元确认场景，但协议已经统一成：

```ts
{
  version: 1,
  kind: string,
  ui: "approval_card",
  title: string,
  summary: string,
  sections: [],
  options: [
    { id: "approve", label: "是" },
    { id: "reject", label: "否" }
  ],
  metadata?: Record<string, unknown>
}
```

也就是说：

- 旧的 `content` 现在映射为 `summary`
- `sections` 固定为空数组
- 按钮仍然是“是 / 否”

## 恢复运行时推荐发送

点击“是”：

```json
{
  "approved": true,
  "decisionId": "approve",
  "source": "approval_card"
}
```

点击“否”：

```json
{
  "approved": false,
  "decisionId": "reject",
  "source": "approval_card"
}
```

## 前端建议

- 直接复用 `approval_card` 组件
- 当 `sections.length === 0` 时，只展示 `title + summary + buttons`
- 不要再继续依赖 `simple_binary_confirmation_card`

## 主文档

完整协议请看：

- [HITL_INTERRUPT_CARD_PROTOCOL.md](/Users/yangguang/Desktop/简历/react-agent-js/HITL_INTERRUPT_CARD_PROTOCOL.md)
