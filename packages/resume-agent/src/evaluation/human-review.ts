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

import { z } from 'zod'

export const RESUME_HUMAN_REVIEW_RUBRIC_REVISION = 'resume-human-review-v1'
export const RESUME_HUMAN_REVIEW_DIMENSIONS = [
  'factual_fidelity',
  'requirement_focus',
  'evidence_specificity',
  'clarity',
] as const

export const resumeHumanReviewRubricV1 = {
  revision: RESUME_HUMAN_REVIEW_RUBRIC_REVISION,
  dimensions: {
    factual_fidelity: {
      question:
        'Are all material statements supported by and consistent with the candidate evidence?',
      anchors: {
        meets:
          'Every material statement is supported by the supplied evidence.',
        minor_issue:
          'Only a limited ambiguity or mildly overstated statement is present.',
        major_issue:
          'At least one material statement is unsupported, invented, or contradicted.',
        not_assessable: 'The supplied evidence is insufficient to decide.',
      },
    },
    requirement_focus: {
      question:
        'Does the resume prioritize the job description’s core requirements?',
      anchors: {
        meets: 'The emphasis consistently matches the core requirements.',
        minor_issue: 'A small number of priorities are misplaced or omitted.',
        major_issue:
          'The resume is generic, misfocused, or omits core requirements.',
        not_assessable: 'The job evidence is insufficient to decide.',
      },
    },
    evidence_specificity: {
      question:
        'Are important matches expressed with specific, relevant candidate evidence?',
      anchors: {
        meets:
          'Important matches consistently use specific, relevant evidence.',
        minor_issue:
          'A small number of statements are generic or weakly tied to evidence.',
        major_issue:
          'Many statements are vague or connect the wrong evidence to a requirement.',
        not_assessable: 'The candidate evidence is insufficient to decide.',
      },
    },
    clarity: {
      question:
        'Is the content clear, concise, and logically organized without changing facts?',
      anchors: {
        meets: 'The content is clear, concise, and logically organized.',
        minor_issue:
          'Local redundancy or a small clarity problem does not block understanding.',
        major_issue:
          'The content is difficult to understand, disorganized, or materially verbose.',
        not_assessable:
          'The output is incomplete or the reviewer cannot assess its language.',
      },
    },
  },
} as const

const StableCodeSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)

const AssignmentIdentifierSchema = StableCodeSchema.refine(
  (value) => value.startsWith('assignment-'),
  'Assignment identifiers must start with assignment-'
)
const BlindedVariantIdentifierSchema = StableCodeSchema.refine(
  (value) => value.startsWith('blind-'),
  'Blinded variant identifiers must start with blind-'
)
const ReviewerPseudonymSchema = StableCodeSchema.refine(
  (value) => value.startsWith('reviewer-'),
  'Reviewer pseudonyms must start with reviewer-'
)

export const ResumeHumanReviewRatingSchema = z.enum([
  'meets',
  'minor_issue',
  'major_issue',
  'not_assessable',
])

export const ResumeHumanReviewIssueCodeSchema = z.enum([
  'unsupported_claim',
  'contradicted_candidate_evidence',
  'omitted_must_have',
  'irrelevant_emphasis',
  'vague_evidence',
  'unclear_language',
  'poor_content_organization',
  'insufficient_source_evidence',
  'requires_domain_expert',
])

export const ResumeHumanReviewRecommendationSchema = z.enum([
  'accept',
  'revise',
  'reject',
  'not_assessable',
])

export const ResumeHumanReviewSchema = z
  .object({
    assignmentId: AssignmentIdentifierSchema,
    caseId: StableCodeSchema,
    blindedVariantId: BlindedVariantIdentifierSchema,
    reviewerPseudonym: ReviewerPseudonymSchema,
    ratings: z
      .object({
        factual_fidelity: ResumeHumanReviewRatingSchema,
        requirement_focus: ResumeHumanReviewRatingSchema,
        evidence_specificity: ResumeHumanReviewRatingSchema,
        clarity: ResumeHumanReviewRatingSchema,
      })
      .strict(),
    issueCodes: z
      .array(ResumeHumanReviewIssueCodeSchema)
      .max(20)
      .refine((codes) => new Set(codes).size === codes.length, {
        message: 'Human review issue codes must be unique',
      }),
    overallRecommendation: ResumeHumanReviewRecommendationSchema,
  })
  .strict()

export const ResumeHumanReviewBatchSchema = z
  .object({
    version: z.literal(1),
    rubricRevision: z.literal(RESUME_HUMAN_REVIEW_RUBRIC_REVISION),
    reviews: z.array(ResumeHumanReviewSchema).max(10_000),
  })
  .strict()
  .superRefine((batch, context) => {
    const assignmentIds = new Set<string>()
    const reviewerItems = new Set<string>()

    batch.reviews.forEach((review, index) => {
      if (assignmentIds.has(review.assignmentId)) {
        context.addIssue({
          code: 'custom',
          message: 'Human review assignment ids must be unique',
          path: ['reviews', index, 'assignmentId'],
        })
      }
      assignmentIds.add(review.assignmentId)

      const reviewerItem = `${review.reviewerPseudonym}\0${review.caseId}\0${review.blindedVariantId}`
      if (reviewerItems.has(reviewerItem)) {
        context.addIssue({
          code: 'custom',
          message:
            'A reviewer may submit only one review per case and blinded variant',
          path: ['reviews', index, 'reviewerPseudonym'],
        })
      }
      reviewerItems.add(reviewerItem)
    })
  })

export type ResumeHumanReviewRating = z.output<
  typeof ResumeHumanReviewRatingSchema
>
export type ResumeHumanReviewIssueCode = z.output<
  typeof ResumeHumanReviewIssueCodeSchema
>
export type ResumeHumanReviewRecommendation = z.output<
  typeof ResumeHumanReviewRecommendationSchema
>
export type ResumeHumanReviewDimension =
  (typeof RESUME_HUMAN_REVIEW_DIMENSIONS)[number]
export type ResumeHumanReview = z.output<typeof ResumeHumanReviewSchema>
export type ResumeHumanReviewBatch = z.input<
  typeof ResumeHumanReviewBatchSchema
>

export interface ResumeHumanReviewRatingCounts {
  meets: number
  minor_issue: number
  major_issue: number
  not_assessable: number
}

export interface ResumeHumanReviewRecommendationCounts {
  accept: number
  revise: number
  reject: number
  not_assessable: number
}

export interface ResumeHumanReviewCaseVariantAggregate {
  caseId: string
  blindedVariantId: string
  reviewCount: number
  dimensionRatingCounts: {
    factual_fidelity: ResumeHumanReviewRatingCounts
    requirement_focus: ResumeHumanReviewRatingCounts
    evidence_specificity: ResumeHumanReviewRatingCounts
    clarity: ResumeHumanReviewRatingCounts
  }
  overallRecommendationCounts: ResumeHumanReviewRecommendationCounts
  issueCodeCounts: Record<ResumeHumanReviewIssueCode, number>
}

export interface ResumeHumanReviewAgreementMetric {
  comparisons: number
  exactMatches: number
  rate: number | null
}

export interface ResumeHumanReviewPairwiseExactAgreement {
  eligibleCaseVariants: number
  dimensions: Record<
    ResumeHumanReviewDimension,
    ResumeHumanReviewAgreementMetric
  >
  overallRecommendation: ResumeHumanReviewAgreementMetric
}

export interface ResumeHumanReviewReport {
  version: 1
  rubricRevision: typeof RESUME_HUMAN_REVIEW_RUBRIC_REVISION
  totalReviews: number
  caseVariantAggregates: ResumeHumanReviewCaseVariantAggregate[]
  pairwiseExactAgreement: ResumeHumanReviewPairwiseExactAgreement
}

function createRatingCounts(): ResumeHumanReviewRatingCounts {
  return {
    meets: 0,
    minor_issue: 0,
    major_issue: 0,
    not_assessable: 0,
  }
}

function createRecommendationCounts(): ResumeHumanReviewRecommendationCounts {
  return {
    accept: 0,
    revise: 0,
    reject: 0,
    not_assessable: 0,
  }
}

function createIssueCodeCounts(): Record<ResumeHumanReviewIssueCode, number> {
  return {
    unsupported_claim: 0,
    contradicted_candidate_evidence: 0,
    omitted_must_have: 0,
    irrelevant_emphasis: 0,
    vague_evidence: 0,
    unclear_language: 0,
    poor_content_organization: 0,
    insufficient_source_evidence: 0,
    requires_domain_expert: 0,
  }
}

function createCaseVariantAggregate(
  review: ResumeHumanReview
): ResumeHumanReviewCaseVariantAggregate {
  return {
    caseId: review.caseId,
    blindedVariantId: review.blindedVariantId,
    reviewCount: 0,
    dimensionRatingCounts: {
      factual_fidelity: createRatingCounts(),
      requirement_focus: createRatingCounts(),
      evidence_specificity: createRatingCounts(),
      clarity: createRatingCounts(),
    },
    overallRecommendationCounts: createRecommendationCounts(),
    issueCodeCounts: createIssueCodeCounts(),
  }
}

function createAgreementMetric(): ResumeHumanReviewAgreementMetric {
  return {
    comparisons: 0,
    exactMatches: 0,
    rate: null,
  }
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

function finalizeAgreementMetric(
  metric: ResumeHumanReviewAgreementMetric
): ResumeHumanReviewAgreementMetric {
  return {
    ...metric,
    rate:
      metric.comparisons === 0
        ? null
        : roundMetric(metric.exactMatches / metric.comparisons),
  }
}

function countPairs(value: number): number {
  return (value * (value - 1)) / 2
}

function countExactRatingPairs(counts: ResumeHumanReviewRatingCounts): number {
  return (
    countPairs(counts.meets) +
    countPairs(counts.minor_issue) +
    countPairs(counts.major_issue) +
    countPairs(counts.not_assessable)
  )
}

function countExactRecommendationPairs(
  counts: ResumeHumanReviewRecommendationCounts
): number {
  return (
    countPairs(counts.accept) +
    countPairs(counts.revise) +
    countPairs(counts.reject) +
    countPairs(counts.not_assessable)
  )
}

function calculatePairwiseExactAgreement(
  aggregates: Iterable<ResumeHumanReviewCaseVariantAggregate>
): ResumeHumanReviewPairwiseExactAgreement {
  const dimensions: Record<
    ResumeHumanReviewDimension,
    ResumeHumanReviewAgreementMetric
  > = {
    factual_fidelity: createAgreementMetric(),
    requirement_focus: createAgreementMetric(),
    evidence_specificity: createAgreementMetric(),
    clarity: createAgreementMetric(),
  }
  const overallRecommendation = createAgreementMetric()
  let eligibleCaseVariants = 0

  for (const aggregate of aggregates) {
    if (aggregate.reviewCount < 2) {
      continue
    }
    eligibleCaseVariants += 1
    const comparisons = countPairs(aggregate.reviewCount)

    for (const dimension of RESUME_HUMAN_REVIEW_DIMENSIONS) {
      const metric = dimensions[dimension]
      metric.comparisons += comparisons
      metric.exactMatches += countExactRatingPairs(
        aggregate.dimensionRatingCounts[dimension]
      )
    }

    overallRecommendation.comparisons += comparisons
    overallRecommendation.exactMatches += countExactRecommendationPairs(
      aggregate.overallRecommendationCounts
    )
  }

  return {
    eligibleCaseVariants,
    dimensions: {
      factual_fidelity: finalizeAgreementMetric(dimensions.factual_fidelity),
      requirement_focus: finalizeAgreementMetric(dimensions.requirement_focus),
      evidence_specificity: finalizeAgreementMetric(
        dimensions.evidence_specificity
      ),
      clarity: finalizeAgreementMetric(dimensions.clarity),
    },
    overallRecommendation: finalizeAgreementMetric(overallRecommendation),
  }
}

export function summarizeResumeHumanReviews(
  batch: ResumeHumanReviewBatch
): ResumeHumanReviewReport {
  const parsed = ResumeHumanReviewBatchSchema.parse(batch)
  const aggregates = new Map<string, ResumeHumanReviewCaseVariantAggregate>()

  for (const review of parsed.reviews) {
    const key = `${review.caseId}\0${review.blindedVariantId}`
    const aggregate = aggregates.get(key) ?? createCaseVariantAggregate(review)

    aggregate.reviewCount += 1
    aggregate.dimensionRatingCounts.factual_fidelity[
      review.ratings.factual_fidelity
    ] += 1
    aggregate.dimensionRatingCounts.requirement_focus[
      review.ratings.requirement_focus
    ] += 1
    aggregate.dimensionRatingCounts.evidence_specificity[
      review.ratings.evidence_specificity
    ] += 1
    aggregate.dimensionRatingCounts.clarity[review.ratings.clarity] += 1
    aggregate.overallRecommendationCounts[review.overallRecommendation] += 1
    for (const issueCode of review.issueCodes) {
      aggregate.issueCodeCounts[issueCode] += 1
    }
    aggregates.set(key, aggregate)
  }

  return {
    version: 1,
    rubricRevision: parsed.rubricRevision,
    totalReviews: parsed.reviews.length,
    caseVariantAggregates: [...aggregates.values()],
    pairwiseExactAgreement: calculatePairwiseExactAgreement(
      aggregates.values()
    ),
  }
}
