/** MIT License
 * Copyright (c) 2023–Present PPResume (https://ppresume.com)
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, subject to the conditions in the project LICENSE.
 */
'use client'
import { Button } from '@appica/ui-react/button'
import { Field, FieldLabel } from '@appica/ui-react/field'
import { useState } from 'react'

export function ProfileView({
  initialResume,
  onSave,
}: {
  initialResume: string
  onSave: (value: string) => void
}) {
  const [resume, setResume] = useState(initialResume)
  return (
    <main className="mx-auto w-full max-w-[760px] p-10">
      <h1 className="text-foreground-strong text-2xl font-semibold">
        个人主页
      </h1>
      <p className="text-foreground-muted mt-2 text-sm">
        保存你的基础简历，Agent 会在对话和生成时自动读取。
      </p>
      <div className="bg-background shadow-md mt-6 rounded-md p-5">
        <Field>
          <FieldLabel>个人简历（YAMLResume 或纯文本）</FieldLabel>
          <textarea
            value={resume}
            onChange={(event) => setResume(event.target.value)}
            rows={18}
            placeholder="粘贴你的简历内容"
            className="text-foreground-strong bg-background-muted mt-2 w-full resize-y rounded-md p-3 text-sm outline-none"
          />
        </Field>
        <Button
          variant="primary"
          className="mt-4"
          onClick={() => onSave(resume)}
        >
          保存个人简历
        </Button>
      </div>
    </main>
  )
}
