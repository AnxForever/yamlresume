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

import type {
  Evidence,
  JobRequirement,
  JobSpec,
  MatchReport,
  RequirementMatch,
} from '@/contracts'

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function keywordMatches(
  requirement: JobRequirement,
  evidence: Evidence[]
): Evidence[] {
  const candidates = [requirement.text, ...requirement.keywords]
    .map(normalize)
    .filter((value) => value.length > 1)

  return evidence.filter((item) => {
    const text = normalize(item.text)
    return candidates.some(
      (candidate) => text.includes(candidate) || candidate.includes(text)
    )
  })
}

function toMatch(
  requirement: JobRequirement,
  matches: Evidence[]
): RequirementMatch {
  const status =
    matches.length === 0
      ? 'missing'
      : matches.length === 1
        ? 'partial'
        : 'matched'
  const rationale =
    status === 'missing'
      ? 'No direct candidate evidence matched this requirement.'
      : `Matched ${matches.length} candidate evidence item${matches.length === 1 ? '' : 's'}.`

  return {
    requirementId: requirement.id,
    requirement: requirement.text,
    status,
    evidenceIds: matches.map((item) => item.id),
    rationale,
  }
}

export function buildMatchReport(
  jobSpec: JobSpec,
  evidence: Evidence[]
): MatchReport {
  const matchedRequirements: RequirementMatch[] = []
  const missingRequirements: RequirementMatch[] = []
  const selectedEvidenceIds = new Set<string>()

  for (const requirement of jobSpec.requirements) {
    const matches = keywordMatches(requirement, evidence)
    const result = toMatch(requirement, matches)

    if (result.status === 'missing') {
      missingRequirements.push(result)
    } else {
      matchedRequirements.push(result)
      result.evidenceIds.forEach((id) => selectedEvidenceIds.add(id))
    }
  }

  const total = jobSpec.requirements.length
  const score =
    total === 0
      ? 0
      : Math.round((matchedRequirements.length / total) * 100) / 100

  return {
    score,
    matchedRequirements,
    missingRequirements,
    selectedEvidenceIds: [...selectedEvidenceIds],
  }
}
