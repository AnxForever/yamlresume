/**
 * MIT License
 *
 * Copyright (c) 2023–Present PPResume (https://ppresume.com)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/**
 * Career Agent capability map.
 *
 * This mirrors the product ledger in
 * `docs/resume-agent-product-roadmap.zh-CN.md` (RP-000..RP-006 and the P0..P5
 * capability tiers). It exists so the UI can show the whole product direction
 * honestly — what works today versus what is only designed — without ever
 * dressing a planned capability up as usable. The roadmap is the source of
 * truth; if this disagrees with it, this file is stale.
 */

import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Database,
  Files,
  MessagesSquare,
  ShieldCheck,
  Target,
  TrendingUp,
  Workflow,
} from 'lucide-react'

export type CapabilityStatus =
  /** Usable now against the running backend. */
  | 'available'
  /** Backend implemented for development only; not durable or production-ready. */
  | 'dev-preview'
  /** Direction recorded, boundaries drawn, not yet built. */
  | 'planned'
  /** Only a problem statement exists; no design yet. */
  | 'idea'

export interface Capability {
  /** Roadmap ledger id, e.g. RP-001. */
  id: string
  /** Capability tier from the roadmap, e.g. P0. */
  tier: string
  icon: LucideIcon
  title: string
  summary: string
  status: CapabilityStatus
  /** A few concrete things this capability does or will do. */
  highlights: string[]
}

export const CAPABILITY_STATUS_META: Record<
  CapabilityStatus,
  { label: string; tone: 'accent' | 'done' | 'mute' }
> = {
  available: { label: '可用', tone: 'done' },
  'dev-preview': { label: '开发预览', tone: 'accent' },
  planned: { label: '规划中', tone: 'mute' },
  idea: { label: '构想', tone: 'mute' },
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'RP-001',
    tier: 'P0',
    icon: Target,
    title: 'JD 定制简历',
    summary: '针对一份岗位 JD，生成可信、可追溯、能过 ATS 的定制简历。',
    status: 'dev-preview',
    highlights: [
      '多文件、图片、PDF、DOCX、YAML 输入归一化',
      'JD 结构化分析与需求→证据匹配',
      '源→草稿 Diff 和确定性质量报告',
      '多样式、多格式导出',
    ],
  },
  {
    id: 'RP-002',
    tier: 'P0',
    icon: MessagesSquare,
    title: '主动澄清提问',
    summary: '缺关键事实或存在冲突时，Agent 用结构化控件提问，而不是瞎猜。',
    status: 'dev-preview',
    highlights: [
      '类型化交互控件（选择 / 文本 / 日期 / 确认…）',
      '运行在 needs_input 暂停并可恢复',
      '回答带幂等键，重复提交安全',
    ],
  },
  {
    id: 'RP-000',
    tier: '—',
    icon: Workflow,
    title: 'Career Agent 中枢',
    summary: '理解长期目标、规划任务、选择能力并维护可恢复运行的顶层入口。',
    status: 'planned',
    highlights: [
      '意图理解与任务规划',
      '能力注册与路由',
      '跨能力共享的职业档案与证据库',
    ],
  },
  {
    id: 'RP-002B',
    tier: 'P1',
    icon: Files,
    title: '求职材料扩展',
    summary: '复用同一份候选人事实库，生成求职信、自我介绍和面试准备材料。',
    status: 'idea',
    highlights: [
      '针对 JD 的求职信',
      '招聘软件开场白与自我介绍',
      '面试问题预测与 STAR 答案草稿',
      '中英文版本一致性检查',
    ],
  },
  {
    id: 'RP-003',
    tier: 'P2',
    icon: TrendingUp,
    title: '差距分析与学习计划',
    summary:
      '对比目标岗位与你的档案，产出能力矩阵和可执行、会动态调整的学习计划。',
    status: 'idea',
    highlights: [
      '能力矩阵与已有证据 / 缺口',
      '按周 / 日拆解的学习计划',
      '“学习 → 实践 → 作品 → 可写入简历”的闭环',
    ],
  },
  {
    id: 'RP-004',
    tier: 'P3',
    icon: BookOpen,
    title: '学习资料研究',
    summary:
      '按你当前水平搜集可靠资料、生成练习并复盘，成果由你确认后写回档案。',
    status: 'idea',
    highlights: [
      '记录来源、发布时间、难度和时长',
      '按水平而非热度推荐',
      '生成练习并评审结果',
    ],
  },
  {
    id: 'RP-005',
    tier: 'P4',
    icon: Database,
    title: '岗位市场知识库',
    summary: '合规采集公开招聘信息，标准化后形成带时间和来源的岗位需求知识库。',
    status: 'idea',
    highlights: [
      '遵守 robots、条款和频率限制',
      '岗位、技能、薪资、城市标准化与去重',
      '每条结论记录样本数、时间和置信度',
    ],
  },
  {
    id: 'RP-006',
    tier: 'P5',
    icon: ShieldCheck,
    title: '岗位与公司健康度',
    summary: '用证据评估岗位和公司的健康度，给出风险等级、不确定性和核实动作。',
    status: 'idea',
    highlights: [
      '识别收费、押金等诈骗信号',
      '交叉验证公司登记、官网和招聘账号',
      '输出“证据 + 风险 + 建议核实动作”',
    ],
  },
]

export function capabilitiesByStatus(
  status: CapabilityStatus,
  source: Capability[] = CAPABILITIES
): Capability[] {
  return source.filter((capability) => capability.status === status)
}

export function isUsable(capability: Capability): boolean {
  return (
    capability.status === 'available' || capability.status === 'dev-preview'
  )
}
