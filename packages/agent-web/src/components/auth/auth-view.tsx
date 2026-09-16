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
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

'use client'

import { Button } from '@appica/ui-react/button'
import { Field, FieldLabel } from '@appica/ui-react/field'
import { Input } from '@appica/ui-react/input'
import { useState } from 'react'
import type { AgentApiClient, AuthSession } from '@/lib/api/client'

export function AuthView({
  client,
  onAuthenticated,
}: {
  client: AgentApiClient
  onAuthenticated: (session: AuthSession) => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    setError(null)
    const result =
      mode === 'login'
        ? await client.login(email, password)
        : await client.register(email, password)
    setBusy(false)
    if (result.kind === 'error') {
      setError(result.error.message)
      return
    }
    onAuthenticated(result.data)
  }
  return (
    <main className="bg-background-subtle flex min-h-screen items-center justify-center p-6">
      <section className="bg-background shadow-xl w-full max-w-[420px] rounded-xl p-8">
        <h1 className="text-foreground-strong text-2xl font-semibold">
          {mode === 'login' ? '登录 Resume Agent' : '创建账户'}
        </h1>
        <p className="text-foreground-muted mt-2 text-sm">
          登录后即可保存对话、生成并管理你的简历。
        </p>
        <div className="mt-6 flex flex-col gap-4">
          <Field>
            <FieldLabel>邮箱</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field>
            <FieldLabel>密码</FieldLabel>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
            />
          </Field>
          {error ? (
            <p role="alert" className="text-error-emphasis text-sm">
              {error}
            </p>
          ) : null}
          <Button
            variant="primary"
            type="button"
            disabled={busy || !email || password.length < 12}
            onClick={() => void submit()}
          >
            {busy ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? '没有账户？注册' : '已有账户？登录'}
          </Button>
        </div>
      </section>
    </main>
  )
}
