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

import type { IncomingMessage } from 'node:http'
import type {
  InputFile,
  InteractionAnswer,
  TailorResumeRequestData,
} from '@yamlresume/resume-agent'
import {
  InteractionAnswerSchema,
  TailorResumeRequestSchema,
} from '@yamlresume/resume-agent'
import Busboy from 'busboy'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 30 * 1024 * 1024
const MAX_FILES = 20

export class MultipartRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MultipartRequestError'
  }
}

interface ParsedMultipartFields {
  jobDescription?: string
  candidate?: string
  preferences?: string
  jobFiles: InputFile[]
  candidateFiles: InputFile[]
}

/**
 * The parsed shape of a multipart interaction answer: the answer body plus
 * the binaries its `file` references point at, keyed by the same fileId the
 * answer declares. A `file:<fileId>` part name is the only supported file
 * field — the answer contract is the source of truth for what is allowed.
 */
export interface ParsedAnswerMultipart {
  answer: InteractionAnswer
  candidateFiles: InputFile[]
}

function parseJsonField(value: string | undefined, field: string): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new MultipartRequestError(
      `Multipart field ${field} must contain valid JSON`
    )
  }
}

export async function parseMultipartRequest(
  request: IncomingMessage
): Promise<TailorResumeRequestData> {
  const contentType = request.headers['content-type']
  if (!contentType) {
    throw new MultipartRequestError('Content-Type is required')
  }

  const fields: ParsedMultipartFields = {
    jobFiles: [],
    candidateFiles: [],
  }
  let totalBytes = 0
  let settled = false

  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: { 'content-type': contentType },
        limits: {
          fileSize: MAX_FILE_BYTES,
          files: MAX_FILES,
          fields: 20,
          parts: MAX_FILES + 20,
        },
      })
    } catch (error) {
      reject(
        new MultipartRequestError(
          error instanceof Error ? error.message : 'Invalid multipart boundary'
        )
      )
      return
    }

    const finishReject = (error: Error): void => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }

    parser.on('field', (name, value) => {
      if (name === 'jobDescription') fields.jobDescription = value
      else if (name === 'candidate') fields.candidate = value
      else if (name === 'preferences') fields.preferences = value
    })

    parser.on('file', (fieldname, file, info) => {
      const chunks: Buffer[] = []
      let fileBytes = 0
      let truncated = false

      file.on('data', (chunk: Buffer) => {
        fileBytes += chunk.length
        totalBytes += chunk.length
        if (totalBytes > MAX_TOTAL_BYTES) {
          file.resume()
          finishReject(
            new MultipartRequestError(
              `Multipart files exceed the ${MAX_TOTAL_BYTES} byte total limit`
            )
          )
          return
        }
        chunks.push(chunk)
      })
      file.on('limit', () => {
        truncated = true
      })
      file.on('end', () => {
        if (settled) return
        if (truncated || fileBytes > MAX_FILE_BYTES) {
          finishReject(
            new MultipartRequestError(
              `${info.filename} exceeds the ${MAX_FILE_BYTES} byte per-file limit`
            )
          )
          return
        }

        const inputFile: InputFile = {
          filename: info.filename,
          mediaType: info.mimeType,
          contentBase64: Buffer.concat(chunks).toString('base64'),
        }
        if (fieldname === 'jobFiles') fields.jobFiles.push(inputFile)
        else if (fieldname === 'candidateFiles') {
          fields.candidateFiles.push(inputFile)
        } else {
          finishReject(
            new MultipartRequestError(
              `Unsupported multipart file field: ${fieldname}`
            )
          )
        }
      })
    })

    parser.on('filesLimit', () => {
      finishReject(
        new MultipartRequestError(`At most ${MAX_FILES} files are allowed`)
      )
    })
    parser.on('fieldsLimit', () => {
      finishReject(new MultipartRequestError('Too many multipart fields'))
    })
    parser.on('partsLimit', () => {
      finishReject(new MultipartRequestError('Too many multipart parts'))
    })
    parser.on('error', (error) => {
      finishReject(
        new MultipartRequestError(
          error instanceof Error ? error.message : String(error)
        )
      )
    })
    parser.on('close', () => {
      if (settled) return
      try {
        const candidateValue = parseJsonField(fields.candidate, 'candidate')
        const preferencesValue = parseJsonField(
          fields.preferences,
          'preferences'
        )
        const candidate = {
          ...(typeof candidateValue === 'object' && candidateValue !== null
            ? candidateValue
            : {}),
          files: fields.candidateFiles,
        }
        const payload = {
          jobDescription: fields.jobDescription,
          jobFiles: fields.jobFiles,
          candidate,
          preferences: preferencesValue,
        }
        const parsed = TailorResumeRequestSchema.safeParse(payload)
        if (!parsed.success) {
          const issue = parsed.error.issues[0]
          throw new MultipartRequestError(
            `Invalid multipart request${issue?.path.length ? ` (${issue.path.join('.')})` : ''}: ${issue?.message ?? 'unknown validation error'}`
          )
        }
        settled = true
        resolve(parsed.data)
      } catch (error) {
        finishReject(
          error instanceof MultipartRequestError
            ? error
            : new MultipartRequestError(
                error instanceof Error ? error.message : String(error)
              )
        )
      }
    })

    request.pipe(parser)
  })
}

/**
 * Parse a multipart interaction answer.
 *
 * The `answer` field carries the JSON answer; every other file part must be
 * named `file:<fileId>` so the parsed `InputFile` keeps the same id the
 * answer references. Duplicate ids are rejected rather than silently
 * keeping the last one — two files claiming one reference is a client bug
 * that must not resolve by chance.
 */
export async function parseAnswerMultipartRequest(
  request: IncomingMessage
): Promise<ParsedAnswerMultipart> {
  const contentType = request.headers['content-type']
  if (!contentType) {
    throw new MultipartRequestError('Content-Type is required')
  }

  let answerValue: string | undefined
  const candidateFiles: InputFile[] = []
  const seenFileIds = new Set<string>()
  let totalBytes = 0
  let settled = false

  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>
    try {
      parser = Busboy({
        headers: { 'content-type': contentType },
        limits: {
          fileSize: MAX_FILE_BYTES,
          files: MAX_FILES,
          fields: 20,
          parts: MAX_FILES + 20,
        },
      })
    } catch (error) {
      reject(
        new MultipartRequestError(
          error instanceof Error ? error.message : 'Invalid multipart boundary'
        )
      )
      return
    }

    const finishReject = (error: Error): void => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }

    parser.on('field', (name, value) => {
      if (name === 'answer') {
        answerValue = value
        return
      }
      finishReject(
        new MultipartRequestError(`Unsupported multipart field: ${name}`)
      )
    })

    parser.on('file', (fieldname, file, info) => {
      const fileId = fieldname.startsWith('file:')
        ? fieldname.slice('file:'.length)
        : ''
      if (!fileId) {
        finishReject(
          new MultipartRequestError(
            `Unsupported multipart file field: ${fieldname}`
          )
        )
        file.resume()
        return
      }
      if (seenFileIds.has(fileId)) {
        finishReject(
          new MultipartRequestError(`Duplicate file id in answer: ${fileId}`)
        )
        file.resume()
        return
      }

      const chunks: Buffer[] = []
      let fileBytes = 0
      let truncated = false

      file.on('data', (chunk: Buffer) => {
        fileBytes += chunk.length
        totalBytes += chunk.length
        if (totalBytes > MAX_TOTAL_BYTES) {
          file.resume()
          finishReject(
            new MultipartRequestError(
              `Multipart files exceed the ${MAX_TOTAL_BYTES} byte total limit`
            )
          )
          return
        }
        chunks.push(chunk)
      })
      file.on('limit', () => {
        truncated = true
      })
      file.on('end', () => {
        if (settled) return
        if (truncated || fileBytes > MAX_FILE_BYTES) {
          finishReject(
            new MultipartRequestError(
              `${info.filename} exceeds the ${MAX_FILE_BYTES} byte per-file limit`
            )
          )
          return
        }
        seenFileIds.add(fileId)
        candidateFiles.push({
          id: fileId,
          filename: info.filename,
          mediaType: info.mimeType,
          contentBase64: Buffer.concat(chunks).toString('base64'),
        })
      })
    })

    parser.on('filesLimit', () => {
      finishReject(
        new MultipartRequestError(`At most ${MAX_FILES} files are allowed`)
      )
    })
    parser.on('fieldsLimit', () => {
      finishReject(new MultipartRequestError('Too many multipart fields'))
    })
    parser.on('partsLimit', () => {
      finishReject(new MultipartRequestError('Too many multipart parts'))
    })
    parser.on('error', (error) => {
      finishReject(
        new MultipartRequestError(
          error instanceof Error ? error.message : String(error)
        )
      )
    })
    parser.on('close', () => {
      if (settled) return
      try {
        const parsedAnswer = InteractionAnswerSchema.safeParse(
          parseJsonField(answerValue, 'answer')
        )
        if (!parsedAnswer.success) {
          const issue = parsedAnswer.error.issues[0]
          throw new MultipartRequestError(
            `Invalid multipart answer${issue?.path.length ? ` (${issue.path.join('.')})` : ''}: ${issue?.message ?? 'unknown validation error'}`
          )
        }
        settled = true
        resolve({
          answer: parsedAnswer.data,
          candidateFiles,
        })
      } catch (error) {
        finishReject(
          error instanceof MultipartRequestError
            ? error
            : new MultipartRequestError(
                error instanceof Error ? error.message : String(error)
              )
        )
      }
    })

    request.pipe(parser)
  })
}
