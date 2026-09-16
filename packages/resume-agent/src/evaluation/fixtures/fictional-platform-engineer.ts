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

import { EvalCaseSchema } from '@/evaluation/contracts'

export const fictionalPlatformEngineerCase = EvalCaseSchema.parse({
  version: 1,
  id: 'fictional-platform-engineer',
  request: {
    jobDescription:
      'The entirely fictional Lantern Harbor Lab needs a platform engineer to build typed service tooling and reliable delivery pipelines.',
    candidate: {
      resume: {
        content: {
          basics: {
            name: 'Example Candidate',
            email: 'candidate@example.invalid',
            summary: 'Builds fictional developer tools for sandbox systems.',
          },
          education: [],
          projects: [
            {
              name: 'Imaginary Queue Simulator',
              summary:
                'Built a TypeScript simulator for repeatable delivery experiments.',
              keywords: ['TypeScript', 'testing'],
            },
          ],
        },
      },
    },
    preferences: {
      targetTitle: 'Platform Engineer',
      formats: ['yaml'],
      styles: ['ats-compact'],
    },
  },
  expectations: {
    targetTitle: 'Platform Engineer',
    minimumRequirementCoverage: 0.75,
    minimumMustHaveCoverage: 1,
    requiredWarningCodes: ['missing_job_keywords'],
    forbiddenWarningCodes: ['unsupported_claim'],
  },
})
