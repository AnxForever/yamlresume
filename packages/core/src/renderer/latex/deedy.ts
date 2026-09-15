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

import type { Parser } from '@/compiler'
import { MarkdownParser } from '@/compiler'
import type { LatexLayout, Resume } from '@/models'
import { transformResume } from '@/preprocess'
import { getTemplateTranslations } from '@/translations'
import {
  escapeLatex,
  isEmptyValue,
  joinNonEmptyString,
  showIf,
  showIfNotEmpty,
} from '@/utils'
import { LatexRenderer } from './base'
import { normalizeUnit } from './preamble'

/**
 * Renderer for the Deedy Resume template.
 *
 * This template is inspired by the popular "Deedy Resume" originally created
 * by Debarghya Das, a classic two-column design widely used on Overleaf.
 *
 * It uses the `article` document class together with the `paracol` package to
 * produce a narrow-left / wide-right two-column layout:
 * - A full-width header with a large name, headline and contact line.
 * - A narrow left column (~33%) for secondary information such as education,
 *   skills, languages, certificates and interests.
 * - A wide right column for primary information such as the summary, work,
 *   projects, awards, publications, volunteer and references.
 * - Uppercase, accent-colored section headings with a colored `\titlerule`.
 *
 * @see {@link https://www.overleaf.com/latex/templates/deedy-resume-reversed/bjryvfsjdyxz}
 * @see {@link https://github.com/deedy/Deedy-Resume}
 */
class DeedyRenderer extends LatexRenderer {
  // separator for contact info
  private separator: string
  // ratio of the narrow left column
  private columnRatio: string

  /**
   * Constructor for the DeedyRenderer class.
   *
   * @param resume - The resume object
   * @param layoutIndex - The index of the selected layout to use.
   * @param summaryParser - The summary parser used to parse summary field in
   * various sections.
   */
  constructor(
    resume: Resume,
    layoutIndex: number,
    summaryParser: Parser = new MarkdownParser()
  ) {
    super(
      transformResume(resume, layoutIndex, summaryParser, escapeLatex),
      layoutIndex
    )

    this.separator = ' $|$ '
    this.columnRatio = '0.33'
  }

  /**
   * Render the document class configuration.
   *
   * Uses the `article` document class, respecting user-configured paper size
   * and font size, with a default of 11pt.
   */
  private renderDocumentClassConfig(): string {
    const layout = this.resume.layouts?.[this.layoutIndex]

    const fontSize = (layout as LatexLayout)?.typography?.fontSize || '11pt'

    const paperSize =
      (layout as LatexLayout)?.page?.paperSize === 'a4'
        ? 'a4paper'
        : 'letterpaper'

    return `\\documentclass[${paperSize},${normalizeUnit(fontSize)}]{article}`
  }

  /**
   * Render the fontawesome package with fallback from v7 to v5.
   *
   * Uses \IfFileExists to detect if fontawesome7 is available on the user's
   * system, falling back to fontawesome5 if not. Returns an empty string if
   * showIcons is false.
   *
   * @returns The LaTeX code for loading fontawesome package, or empty string
   * if icons are disabled
   */
  private renderFontawesome(): string {
    if (!this.showIcons) {
      return ''
    }

    return `\\IfFileExists{fontawesome7.sty}{%
  \\usepackage{fontawesome7}%
}{%
  \\usepackage{fontawesome5}%
}`
  }

  /**
   * Render the LaTeX packages required by the Deedy template.
   */
  private renderPackages(): string {
    return joinNonEmptyString(
      [
        '\\usepackage{paracol}',
        '\\usepackage{titlesec}',
        '\\usepackage[usenames,dvipsnames]{xcolor}',
        '\\usepackage{enumitem}',
        '\\usepackage{changepage}',
        this.renderFontawesome(),
        '\\usepackage[hidelinks]{hyperref}',
      ],
      '\n'
    )
  }

  /**
   * Render the page numbers configuration.
   */
  private renderPageNumbersConfig(): string {
    const layout = this.resume.layouts?.[this.layoutIndex]
    const page = (layout as LatexLayout)?.page

    return showIf(
      !page?.showPageNumbers,
      `% Disable page numbers
\\pagenumbering{gobble}`
    )
  }

  /**
   * Render the accent color used for section headings.
   */
  private renderColorConfig(): string {
    return `% Deedy accent color
\\definecolor{deedyprimary}{HTML}{2B6CB0}`
  }

  /**
   * Render the section formatting configuration.
   *
   * Produces the Deedy signature: uppercase, accent-colored section headings
   * with a colored titlerule below them. The format is kept compact so it
   * behaves well inside the narrow left column managed by paracol.
   */
  private renderSectionFormatting(): string {
    return `% global itemize spacing
\\setlist[itemize]{nosep, leftmargin=*}
\\setlength{\\parindent}{0pt}

% Sections formatting - uppercase, accent-colored with a colored titlerule
\\titleformat{\\section}{
  \\vspace{-4pt}\\color{deedyprimary}\\scshape\\raggedright\\large
}{}{0em}{}[{\\color{deedyprimary}\\titlerule}\\vspace{-4pt}]
\\titlespacing*{\\section}{0pt}{8pt}{4pt}`
  }

  /**
   * Render the custom resume commands used by the Deedy template.
   */
  private renderCustomCommands(): string {
    return `% Custom commands
% Wide-column entry: bold title with right-aligned date, then italic
% subtitle on the next line.
\\newcommand{\\resumeEntry}[4]{
  \\noindent\\textbf{#1}\\hfill{#2}\\\\
  \\textit{#3}\\hfill{#4}\\\\[2pt]
}
% Narrow-column entry: stacked institution, detail and date lines.
\\newcommand{\\resumeStack}[3]{
  \\noindent\\textbf{#1}\\\\
  #2\\\\
  #3\\\\[4pt]
}

% Auto-underline all links
\\let\\oldhref\\href
\\renewcommand{\\href}[2]{\\oldhref{#1}{\\underline{#2}}}
`
  }

  /**
   * Render PDF metadata using hyperref.
   */
  private renderPdfMetadata(): string {
    const { name, headline } = this.resume.content.basics
    const keywords = this.resume.content.skills
      ?.map((skill) => skill.name)
      .join(', ')

    return `%% PDF metadata
\\hypersetup{
  pdfauthor={${name}},
  pdftitle={${joinNonEmptyString([name, headline], ' - ')}},
  pdfkeywords={${keywords}},
  pdfsubject={Résumé of ${name}},
  pdfcreator={YAMLResume (https://yamlresume.dev)},
}`
  }

  /**
   * Render the preamble for the resume.
   *
   * @returns The LaTeX code for the preamble
   */
  renderPreamble(): string {
    if (this.resume.layouts?.[this.layoutIndex]?.engine !== 'latex') {
      return ''
    }

    return joinNonEmptyString([
      this.renderDocumentClassConfig(),
      this.renderPackages(),

      // page layout
      this.renderGeometry(),
      this.renderPageNumbersConfig(),

      // language specific
      this.renderBabelConfig(),

      // fontspec
      this.renderFontspecConfig(),

      // CTeX for CJK
      this.renderCTeXConfig(),

      // line spacing
      this.renderLineSpacingConfig(),

      // URL styling - use same font as surrounding text instead of monospace
      this.renderUrlConfig(),

      // PDF metadata
      this.renderPdfMetadata(),

      // accent color
      this.renderColorConfig(),

      // section formatting and custom commands
      this.renderSectionFormatting(),
      this.renderCustomCommands(),
    ])
  }

  /**
   * Render the basics section (full-width, left-aligned header).
   *
   * Deedy style uses a large name followed by a headline. The contact line
   * (location, phone, email, url) is appended right after, separated by the
   * configured separator.
   *
   * @returns The LaTeX code for the heading
   */
  renderBasics(): string {
    const {
      content: {
        basics: { name, headline, phone, email, url },
      },
    } = this.resume

    if (isEmptyValue(name)) {
      return ''
    }

    const contactLine = joinNonEmptyString(
      [
        this.renderLocation(),
        showIfNotEmpty(phone, this.iconedString('\\faPhoneVolume', phone)),
        showIfNotEmpty(
          email,
          this.iconedString(
            '\\faEnvelope[regular]',
            `\\href{mailto:${email}}{${email}}`
          )
        ),
        showIfNotEmpty(url, this.iconedString('\\faGlobe', `\\url{${url}}`)),
      ],
      this.separator
    )

    return joinNonEmptyString([
      `\\textbf{\\Huge \\scshape ${name}}\\vspace{2pt}`,
      showIfNotEmpty(headline, `{\\Large ${headline}}\\vspace{2pt}`),
      showIfNotEmpty(contactLine, contactLine),
    ])
  }

  /**
   * Render the location (full address) for use in the contact line.
   *
   * @returns The LaTeX code for the location line
   */
  renderLocation(): string {
    const {
      content: {
        location: {
          computed: { fullAddress },
        },
      },
    } = this.resume

    return showIfNotEmpty(
      fullAddress,
      this.iconedString('\\faMapMarker', `${fullAddress}`)
    )
  }

  /**
   * Render homepage and profiles as a line below the contact info.
   *
   * @returns The LaTeX code for the profiles line
   */
  renderProfiles(): string {
    const {
      content: { profiles },
    } = this.resume

    if (isEmptyValue(profiles)) {
      return ''
    }

    const profileLinks = profiles
      .map(({ network, url, username }) => {
        const icon = this.getFaIcon(network)
        return isEmptyValue(username) || isEmptyValue(network)
          ? ''
          : `${icon}\\href{${url}}{${username}}`
      })
      .filter((link) => !isEmptyValue(link))

    return `${profileLinks.join(this.separator)}`
  }

  /**
   * Render the summary section.
   *
   * In the Deedy layout this sits at the top of the wide right column.
   *
   * @returns The LaTeX code for the summary section
   */
  renderSummary(): string {
    const {
      content: {
        basics: {
          computed: { summary },
        },
        computed: { sectionNames },
      },
    } = this.resume

    return showIfNotEmpty(
      summary,
      `\\section{${sectionNames.basics}}

${summary}`
    )
  }

  /**
   * Render the education section (narrow left column).
   *
   * Uses the compact `\resumeStack` command: institution, degree/area/score,
   * then the date range, each on its own line.
   *
   * @returns The LaTeX code for the education section
   */
  renderEducation(): string {
    const {
      content: {
        computed: { sectionNames },
        education,
      },
      locale,
    } = this.resume

    const {
      punctuations: { colon },
      terms,
    } = getTemplateTranslations(locale?.language)

    if (isEmptyValue(education)) {
      return ''
    }

    return `\\section{${sectionNames.education}}
${education
  .map(
    ({
      computed: { startDate, dateRange, degreeAreaAndScore, summary, courses },
      institution,
      url,
    }) =>
      joinNonEmptyString(
        [
          `\\resumeStack
{${showIfNotEmpty(url, `\\href{${url}}{${institution}}`) || institution}}
{${degreeAreaAndScore}}
{${showIfNotEmpty(startDate, dateRange)}}`,
          showIf(
            !isEmptyValue(summary) || !isEmptyValue(courses),
            joinNonEmptyString(
              [
                showIfNotEmpty(summary, `${summary}`),
                showIfNotEmpty(
                  courses,
                  `\\textbf{${terms.courses}}${colon}${courses}`
                ),
              ],
              '\n'
            )
          ),
        ],
        '\n'
      )
  )
  .join('\n\n')}`
  }

  /**
   * Render the skills section (narrow left column).
   *
   * Uses a compact `name: keywords` format.
   *
   * @returns The LaTeX code for the skills section
   */
  renderSkills(): string {
    const {
      content: {
        computed: { sectionNames },
        skills,
      },
      locale,
    } = this.resume

    if (isEmptyValue(skills)) {
      return ''
    }

    const {
      punctuations: { colon },
    } = getTemplateTranslations(locale?.language)

    return `\\section{${sectionNames.skills}}
${skills
  .map(
    ({ name, computed: { level, keywords } }) =>
      `\\textbf{${name}}${showIfNotEmpty(
        level,
        `${colon}${level}`
      )}${showIfNotEmpty(keywords, `\\\\${keywords}`)}`
  )
  .join('\n\n')}`
  }

  /**
   * Render the languages section (narrow left column).
   *
   * Uses a compact `language: fluency` format.
   *
   * @returns The LaTeX code for the languages section
   */
  renderLanguages(): string {
    const {
      content: {
        computed: { sectionNames },
        languages,
      },
      locale,
    } = this.resume

    if (isEmptyValue(languages)) {
      return ''
    }

    const {
      punctuations: { colon },
      terms,
    } = getTemplateTranslations(locale?.language)

    return `\\section{${sectionNames.languages}}
${languages
  .map(
    ({ computed: { language, fluency, keywords } }) =>
      `\\textbf{${language}}${showIfNotEmpty(
        fluency,
        `${colon}${fluency}`
      )}${showIfNotEmpty(
        keywords,
        `\\\\\\textbf{${terms.keywords}}${colon}${keywords}`
      )}`
  )
  .join('\n\n')}`
  }

  /**
   * Render the certificates section (narrow left column).
   *
   * @returns The LaTeX code for the certificates section
   */
  renderCertificates(): string {
    const {
      content: {
        computed: { sectionNames },
        certificates,
      },
    } = this.resume

    if (isEmptyValue(certificates)) {
      return ''
    }

    return `\\section{${sectionNames.certificates}}
${certificates
  .map(
    ({ computed: { date }, issuer, name, url }) =>
      `\\resumeStack
{${showIfNotEmpty(url, `\\href{${url}}{${name}}`) || name}}
{${issuer}}
{${date}}`
  )
  .join('\n\n')}`
  }

  /**
   * Render the interests section (narrow left column).
   *
   * @returns The LaTeX code for the interests section
   */
  renderInterests(): string {
    const {
      content: { interests, computed },
      locale,
    } = this.resume

    if (isEmptyValue(interests)) {
      return ''
    }

    const {
      punctuations: { colon },
    } = getTemplateTranslations(locale?.language)

    return `\\section{${computed.sectionNames.interests}}
${interests
  .map(
    ({ name, computed: { keywords } }) =>
      `\\textbf{${name}}${showIfNotEmpty(keywords, `${colon}${keywords}`)}`
  )
  .join('\n\n')}`
  }

  /**
   * Render the work section (wide right column).
   *
   * Uses the `\resumeEntry` command: bold position with a right-aligned date
   * range, italic company with optional URL, then the summary and keywords.
   *
   * @returns The LaTeX code for the work section
   */
  renderWork(): string {
    const {
      content: { work, computed },
      locale,
    } = this.resume

    const {
      punctuations: { colon },
      terms,
    } = getTemplateTranslations(locale?.language)

    if (isEmptyValue(work)) {
      return ''
    }

    return `\\section{${computed.sectionNames.work}}
${work
  .map(
    ({
      computed: { startDate, dateRange, summary, keywords },
      name,
      position,
      url,
    }) =>
      joinNonEmptyString(
        [
          `\\resumeEntry
{${position}}{${showIfNotEmpty(startDate, dateRange)}}
{${name}}{${showIfNotEmpty(url, `\\href{${url}}{${url}}`)}}`,
          showIf(
            !isEmptyValue(summary) || !isEmptyValue(keywords),
            joinNonEmptyString(
              [
                showIfNotEmpty(summary, `${summary}`),
                showIfNotEmpty(
                  keywords,
                  `\\textbf{${terms.keywords}}${colon}${keywords}`
                ),
              ],
              '\n'
            )
          ),
        ],
        '\n'
      )
  )
  .join('\n\n')}`
  }

  /**
   * Render the projects section (wide right column).
   *
   * @returns The LaTeX code for the projects section
   */
  renderProjects(): string {
    const {
      content: { projects, computed },
      locale,
    } = this.resume

    const {
      punctuations: { colon },
      terms,
    } = getTemplateTranslations(locale?.language)

    if (isEmptyValue(projects)) {
      return ''
    }

    return `\\section{${computed.sectionNames.projects}}
${projects
  .map(
    ({
      name,
      description,
      url,
      computed: { dateRange, startDate, summary, keywords },
    }) =>
      joinNonEmptyString(
        [
          `\\resumeEntry
{${name}}{${showIfNotEmpty(startDate, dateRange)}}
{${description}}{${showIfNotEmpty(url, `\\href{${url}}{${url}}`)}}`,
          showIf(
            !isEmptyValue(summary) || !isEmptyValue(keywords),
            joinNonEmptyString(
              [
                showIfNotEmpty(summary, `${summary}`),
                showIfNotEmpty(
                  keywords,
                  `\\textbf{${terms.keywords}}${colon}${keywords}`
                ),
              ],
              '\n'
            )
          ),
        ],
        '\n'
      )
  )
  .join('\n\n')}`
  }

  /**
   * Render the awards section (wide right column).
   *
   * @returns The LaTeX code for the awards section
   */
  renderAwards(): string {
    const {
      content: {
        computed: { sectionNames },
        awards,
      },
    } = this.resume

    if (isEmptyValue(awards)) {
      return ''
    }

    return `\\section{${sectionNames.awards}}
${awards
  .map(({ computed: { date, summary }, awarder, title }) =>
    joinNonEmptyString(
      [
        `\\resumeEntry
{${title}}{${date}}
{${awarder}}{}`,
        showIfNotEmpty(summary, `${summary}`),
      ],
      '\n'
    )
  )
  .join('\n\n')}`
  }

  /**
   * Render the publications section (wide right column).
   *
   * @returns The LaTeX code for the publications section
   */
  renderPublications(): string {
    const {
      content: {
        computed: { sectionNames },
        publications,
      },
    } = this.resume

    if (isEmptyValue(publications)) {
      return ''
    }

    return `\\section{${sectionNames.publications}}
${publications
  .map(({ computed: { releaseDate, summary }, name, publisher, url }) =>
    joinNonEmptyString(
      [
        `\\resumeEntry
{${name}}{${releaseDate}}
{${publisher}}{${showIfNotEmpty(url, `\\href{${url}}{${url}}`)}}`,
        showIfNotEmpty(summary, `${summary}`),
      ],
      '\n'
    )
  )
  .join('\n\n')}`
  }

  /**
   * Render the volunteer section (wide right column).
   *
   * @returns The LaTeX code for the volunteer section
   */
  renderVolunteer(): string {
    const {
      content: { volunteer, computed },
    } = this.resume

    if (isEmptyValue(volunteer)) {
      return ''
    }

    return `\\section{${computed.sectionNames.volunteer}}
${volunteer
  .map(
    ({
      position,
      organization,
      url,
      computed: { startDate, dateRange, summary },
    }) =>
      joinNonEmptyString(
        [
          `\\resumeEntry
{${position}}{${showIfNotEmpty(startDate, dateRange)}}
{${organization}}{${showIfNotEmpty(url, `\\href{${url}}{${url}}`)}}`,
          showIfNotEmpty(summary, `${summary}`),
        ],
        '\n'
      )
  )
  .join('\n\n')}`
  }

  /**
   * Render the references section (wide right column).
   *
   * @returns The LaTeX code for the references section
   */
  renderReferences(): string {
    const {
      content: {
        computed: { sectionNames },
        references,
      },
    } = this.resume

    if (isEmptyValue(references)) {
      return ''
    }

    return `\\section{${sectionNames.references}}
${references
  .map(({ email, relationship, name, phone, computed: { summary } }) =>
    joinNonEmptyString(
      [
        `\\resumeEntry
{${name}}{${relationship}}
{${email}}{${phone}}`,
        showIfNotEmpty(summary, `${summary}`),
      ],
      '\n'
    )
  )
  .join('\n\n')}`
  }

  /**
   * Render the contents of the narrow left column.
   *
   * Secondary information lives here: education, skills, languages,
   * certificates and interests. Empty sections are filtered out so no empty
   * column or stray heading is produced.
   *
   * @returns The LaTeX code for the left column
   */
  private renderLeftColumn(): string {
    return joinNonEmptyString([
      this.renderEducation(),
      this.renderSkills(),
      this.renderLanguages(),
      this.renderCertificates(),
      this.renderInterests(),
    ])
  }

  /**
   * Render the contents of the wide right column.
   *
   * Primary information lives here: summary, work, projects, awards,
   * publications, volunteer and references. Empty sections are filtered out.
   *
   * @returns The LaTeX code for the right column
   */
  private renderRightColumn(): string {
    return joinNonEmptyString([
      this.renderSummary(),
      this.renderWork(),
      this.renderProjects(),
      this.renderAwards(),
      this.renderPublications(),
      this.renderVolunteer(),
      this.renderReferences(),
    ])
  }

  /**
   * Render the full-width header block (basics + profiles).
   *
   * @returns The LaTeX code for the header
   */
  private renderHeader(): string {
    return joinNonEmptyString([this.renderBasics(), this.renderProfiles()])
  }

  /**
   * Render the resume.
   *
   * @returns The LaTeX code for the resume
   */
  render(): string {
    return this.generateTeX()
  }

  /**
   * Generate the LaTeX code for the resume.
   *
   * Assembles the preamble, a full-width header, and a two-column body driven
   * by the `paracol` package: a narrow left column for secondary information
   * and a wide right column for primary information.
   *
   * @returns The LaTeX code for the resume
   */
  private generateTeX(): string {
    return `${this.renderPreamble()}

\\begin{document}

${this.renderHeader()}

\\bigskip

\\columnratio{${this.columnRatio}}
\\begin{paracol}{2}

${this.renderLeftColumn()}

\\switchcolumn

${this.renderRightColumn()}

\\end{paracol}
\\end{document}`
  }
}

export { DeedyRenderer }
