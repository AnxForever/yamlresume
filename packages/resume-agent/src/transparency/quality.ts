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

import type { Resume } from '@yamlresume/core'

import type { JobSpec, QualityReport, QualityWarning } from '@/contracts'
import { buildMatchReport } from '@/matching/match'
import { buildEvidenceIndex } from '@/validation/evidence'

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

export function buildQualityReport(
  jobSpec: JobSpec,
  resume: Resume
): QualityReport {
  const evidence = buildEvidenceIndex(resume)
  const matchReport = buildMatchReport(jobSpec, evidence)
  const resumeText = normalize(evidence.map((item) => item.text).join('\n'))
  const keywords = [
    ...new Set(jobSpec.keywords.map((keyword) => keyword.trim())),
  ]
    .filter((keyword) => keyword.length > 0)
    .sort((left, right) => left.localeCompare(right))
  const matchedKeywords = keywords.filter((keyword) =>
    resumeText.includes(normalize(keyword))
  )
  const missingKeywords = keywords.filter(
    (keyword) => !matchedKeywords.includes(keyword)
  )
  const mustHaveIds = new Set(
    jobSpec.requirements
      .filter((requirement) => requirement.importance === 'must-have')
      .map((requirement) => requirement.id)
  )
  const matchedMustHaveIds = new Set(
    matchReport.matchedRequirements
      .filter((requirement) => mustHaveIds.has(requirement.requirementId))
      .map((requirement) => requirement.requirementId)
  )
  const missingMustHave = jobSpec.requirements
    .filter(
      (requirement) =>
        requirement.importance === 'must-have' &&
        !matchedMustHaveIds.has(requirement.id)
    )
    .map((requirement) => requirement.text)
  const warnings: QualityWarning[] = []

  if (missingMustHave.length > 0) {
    warnings.push({
      code: 'missing_must_have_requirements',
      severity: 'warning',
      message: `${missingMustHave.length} must-have requirement${missingMustHave.length === 1 ? ' is' : 's are'} not represented in the final resume.`,
    })
  }
  if (missingKeywords.length > 0) {
    warnings.push({
      code: 'missing_job_keywords',
      severity: 'info',
      message: `${missingKeywords.length} extracted job keyword${missingKeywords.length === 1 ? ' is' : 's are'} absent from the final resume.`,
    })
  }
  if (evidence.length < 5) {
    warnings.push({
      code: 'sparse_resume_content',
      severity: 'warning',
      message:
        'The final resume contains very little evidence and may be underspecified.',
    })
  }

  return {
    requirementCoverage:
      jobSpec.requirements.length === 0
        ? 1
        : round(
            matchReport.matchedRequirements.length / jobSpec.requirements.length
          ),
    mustHaveCoverage:
      mustHaveIds.size === 0
        ? 1
        : round(matchedMustHaveIds.size / mustHaveIds.size),
    keywordCoverage:
      keywords.length === 0
        ? 1
        : round(matchedKeywords.length / keywords.length),
    matchedKeywords,
    missingKeywords,
    missingMustHave,
    warnings,
  }
}
