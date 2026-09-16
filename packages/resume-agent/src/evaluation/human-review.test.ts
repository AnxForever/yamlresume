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

import { describe, expect, it } from 'vitest'

import {
  ResumeHumanReviewBatchSchema,
  resumeHumanReviewRubricV1,
  summarizeResumeHumanReviews,
} from '@/index'

const baseReview = {
  assignmentId: 'assignment-001',
  caseId: 'public-example-case',
  blindedVariantId: 'blind-a',
  reviewerPseudonym: 'reviewer-001',
  ratings: {
    factual_fidelity: 'meets',
    requirement_focus: 'meets',
    evidence_specificity: 'meets',
    clarity: 'meets',
  },
  issueCodes: [],
  overallRecommendation: 'accept',
}

describe('summarizeResumeHumanReviews', () => {
  it('summarizes one blinded review with the versioned rubric', () => {
    const batch = ResumeHumanReviewBatchSchema.parse({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [
        {
          assignmentId: 'assignment-001',
          caseId: 'public-example-case',
          blindedVariantId: 'blind-a',
          reviewerPseudonym: 'reviewer-001',
          ratings: {
            factual_fidelity: 'meets',
            requirement_focus: 'minor_issue',
            evidence_specificity: 'meets',
            clarity: 'meets',
          },
          issueCodes: ['irrelevant_emphasis'],
          overallRecommendation: 'revise',
        },
      ],
    })

    expect(resumeHumanReviewRubricV1.revision).toBe('resume-human-review-v1')
    expect(summarizeResumeHumanReviews(batch)).toMatchObject({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      totalReviews: 1,
      caseVariantAggregates: [
        {
          caseId: 'public-example-case',
          blindedVariantId: 'blind-a',
          reviewCount: 1,
          dimensionRatingCounts: {
            factual_fidelity: {
              meets: 1,
              minor_issue: 0,
              major_issue: 0,
              not_assessable: 0,
            },
            requirement_focus: {
              meets: 0,
              minor_issue: 1,
              major_issue: 0,
              not_assessable: 0,
            },
          },
          overallRecommendationCounts: {
            accept: 0,
            revise: 1,
            reject: 0,
            not_assessable: 0,
          },
          issueCodeCounts: {
            irrelevant_emphasis: 1,
          },
        },
      ],
    })
  })

  it('rejects duplicate issue codes before aggregation', () => {
    const result = ResumeHumanReviewBatchSchema.safeParse({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [
        {
          assignmentId: 'assignment-duplicate-issues',
          caseId: 'public-example-case',
          blindedVariantId: 'blind-a',
          reviewerPseudonym: 'reviewer-001',
          ratings: {
            factual_fidelity: 'major_issue',
            requirement_focus: 'meets',
            evidence_specificity: 'minor_issue',
            clarity: 'meets',
          },
          issueCodes: ['unsupported_claim', 'unsupported_claim'],
          overallRecommendation: 'reject',
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('rejects an unbounded review batch', () => {
    const review = {
      assignmentId: 'assignment-bounded',
      caseId: 'public-example-case',
      blindedVariantId: 'blind-a',
      reviewerPseudonym: 'reviewer-001',
      ratings: {
        factual_fidelity: 'meets',
        requirement_focus: 'meets',
        evidence_specificity: 'meets',
        clarity: 'meets',
      },
      issueCodes: [],
      overallRecommendation: 'accept',
    }

    const result = ResumeHumanReviewBatchSchema.safeParse({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: Array.from({ length: 10_001 }, () => review),
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(
        expect.objectContaining({ code: 'too_big', path: ['reviews'] })
      )
    }
  })

  it.each([
    [
      'assignment id',
      [baseReview, { ...baseReview, reviewerPseudonym: 'reviewer-002' }],
    ],
    [
      'reviewer and case/variant combination',
      [baseReview, { ...baseReview, assignmentId: 'assignment-002' }],
    ],
  ])('rejects a duplicate %s', (_description, reviews) => {
    const result = ResumeHumanReviewBatchSchema.safeParse({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews,
    })

    expect(result.success).toBe(false)
  })

  it('reports pairwise exact agreement for two reviewers of one item', () => {
    const report = summarizeResumeHumanReviews({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [
        baseReview,
        {
          ...baseReview,
          assignmentId: 'assignment-002',
          reviewerPseudonym: 'reviewer-002',
          ratings: {
            ...baseReview.ratings,
            requirement_focus: 'major_issue',
            clarity: 'minor_issue',
          },
          overallRecommendation: 'revise',
        },
      ],
    })

    expect(report.pairwiseExactAgreement).toEqual({
      eligibleCaseVariants: 1,
      dimensions: {
        factual_fidelity: {
          comparisons: 1,
          exactMatches: 1,
          rate: 1,
        },
        requirement_focus: {
          comparisons: 1,
          exactMatches: 0,
          rate: 0,
        },
        evidence_specificity: {
          comparisons: 1,
          exactMatches: 1,
          rate: 1,
        },
        clarity: {
          comparisons: 1,
          exactMatches: 0,
          rate: 0,
        },
      },
      overallRecommendation: {
        comparisons: 1,
        exactMatches: 0,
        rate: 0,
      },
    })
  })

  it('groups agreement by case and blind variant in first-seen order', () => {
    const report = summarizeResumeHumanReviews({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [
        baseReview,
        {
          ...baseReview,
          assignmentId: 'assignment-002',
          reviewerPseudonym: 'reviewer-002',
          ratings: {
            ...baseReview.ratings,
            factual_fidelity: 'major_issue',
          },
          overallRecommendation: 'reject',
        },
        {
          ...baseReview,
          assignmentId: 'assignment-003',
          reviewerPseudonym: 'reviewer-003',
        },
        {
          ...baseReview,
          assignmentId: 'assignment-004',
          caseId: 'second-public-case',
          blindedVariantId: 'blind-b',
        },
      ],
    })

    expect(
      report.caseVariantAggregates.map((aggregate) => [
        aggregate.caseId,
        aggregate.blindedVariantId,
        aggregate.reviewCount,
      ])
    ).toEqual([
      ['public-example-case', 'blind-a', 3],
      ['second-public-case', 'blind-b', 1],
    ])
    expect(report.pairwiseExactAgreement).toMatchObject({
      eligibleCaseVariants: 1,
      dimensions: {
        factual_fidelity: {
          comparisons: 3,
          exactMatches: 1,
          rate: 0.3333,
        },
        requirement_focus: {
          comparisons: 3,
          exactMatches: 3,
          rate: 1,
        },
      },
      overallRecommendation: {
        comparisons: 3,
        exactMatches: 1,
        rate: 0.3333,
      },
    })
  })

  it('returns null agreement rates for an empty review batch', () => {
    const report = summarizeResumeHumanReviews({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [],
    })

    expect(report).toMatchObject({
      totalReviews: 0,
      caseVariantAggregates: [],
      pairwiseExactAgreement: {
        eligibleCaseVariants: 0,
        dimensions: {
          factual_fidelity: {
            comparisons: 0,
            exactMatches: 0,
            rate: null,
          },
          requirement_focus: { rate: null },
          evidence_specificity: { rate: null },
          clarity: { rate: null },
        },
        overallRecommendation: { rate: null },
      },
    })
    expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/)
  })

  it.each([
    ['free-text notes', { ...baseReview, notes: 'PRIVATE_REVIEW_NOTE' }],
    ['provider identity', { ...baseReview, provider: 'PRIVATE_PROVIDER' }],
    [
      'a non-pseudonymous reviewer id',
      { ...baseReview, reviewerPseudonym: 'alice' },
    ],
    [
      'an unblinded variant id',
      { ...baseReview, blindedVariantId: 'provider-model-v1' },
    ],
  ])('rejects %s', (_description, review) => {
    const result = ResumeHumanReviewBatchSchema.safeParse({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [review],
    })

    expect(result.success).toBe(false)
  })

  it('omits reviewer and assignment identifiers from the safe report', () => {
    const report = summarizeResumeHumanReviews({
      version: 1,
      rubricRevision: 'resume-human-review-v1',
      reviews: [
        {
          ...baseReview,
          assignmentId: 'assignment-private-marker',
          reviewerPseudonym: 'reviewer-private-marker',
        },
      ],
    })

    const serializedReport = JSON.stringify(report)
    expect(serializedReport).not.toContain('assignment-private-marker')
    expect(serializedReport).not.toContain('reviewer-private-marker')
  })

  it('rejects reviews from another rubric revision', () => {
    expect(
      ResumeHumanReviewBatchSchema.safeParse({
        version: 1,
        rubricRevision: 'resume-human-review-v2',
        reviews: [baseReview],
      }).success
    ).toBe(false)
  })
})
