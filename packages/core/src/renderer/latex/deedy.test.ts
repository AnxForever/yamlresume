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

import { cloneDeep } from 'lodash-es'
import { beforeEach, describe, expect, it } from 'vitest'

import { FILLED_RESUME, type Resume } from '@/models'
import { DeedyRenderer } from './deedy'

describe('DeedyRenderer', () => {
  let resume: Resume
  let renderer: DeedyRenderer
  let layoutIndex: number

  beforeEach(() => {
    resume = cloneDeep(FILLED_RESUME)
    layoutIndex = FILLED_RESUME.layouts.findIndex(
      (layout) => layout.engine === 'latex'
    )
    renderer = new DeedyRenderer(resume, layoutIndex)
  })

  it('should generate complete LaTeX document', () => {
    const result = renderer.render()

    expect(result).toContain('\\documentclass')
    expect(result).toContain('\\begin{document}')
    expect(result).toContain('\\end{document}')
  })

  it('should use article document class instead of moderncv', () => {
    const result = renderer.render()

    expect(result).toContain('{article}')
    expect(result).not.toContain('{moderncv}')
  })

  it('should render a two-column body with paracol', () => {
    const result = renderer.render()

    expect(result).toContain('\\usepackage{paracol}')
    expect(result).toContain('\\columnratio{0.33}')
    expect(result).toContain('\\begin{paracol}{2}')
    expect(result).toContain('\\switchcolumn')
    expect(result).toContain('\\end{paracol}')
  })

  it('should not contain literal null or undefined', () => {
    const result = renderer.render()

    expect(result).not.toContain('null')
    expect(result).not.toContain('undefined')
  })

  it('should degrade gracefully with an empty resume', () => {
    const emptyResume = cloneDeep(resume)
    emptyResume.content.basics = { name: '', headline: '' }
    emptyResume.content.location = { city: '' }
    emptyResume.content.profiles = []
    emptyResume.content.education = []
    emptyResume.content.work = []
    emptyResume.content.languages = []
    emptyResume.content.skills = []
    emptyResume.content.awards = []
    emptyResume.content.certificates = []
    emptyResume.content.publications = []
    emptyResume.content.references = []
    emptyResume.content.projects = []
    emptyResume.content.interests = []
    emptyResume.content.volunteer = []

    renderer = new DeedyRenderer(emptyResume, layoutIndex)
    const result = renderer.render()

    expect(result).toContain('\\documentclass')
    expect(result).toContain('\\begin{document}')
    expect(result).toContain('\\end{document}')
    expect(result).not.toContain('null')
    expect(result).not.toContain('undefined')
  })

  it('should degrade gracefully when layout is missing', () => {
    resume.layouts = undefined
    renderer = new DeedyRenderer(resume, layoutIndex)
    const result = renderer.render()

    expect(result).toContain('\\begin{document}')
    expect(result).toContain('\\end{document}')
    expect(result).not.toContain('null')
    expect(result).not.toContain('undefined')
  })

  describe('renderPreamble', () => {
    it('should return empty preamble when layout engine is not latex', () => {
      resume.layouts = [{ engine: 'markdown', sections: {} }]
      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPreamble()
      expect(result).toBe('')
    })

    it('should render correct document class configuration from FILLED_RESUME', () => {
      const result = renderer.renderPreamble()

      // FILLED_RESUME has a4 paper and 10pt configured
      expect(result).toContain('\\documentclass[a4paper,10pt]{article}')
    })

    it('should render a4 paper size when paperSize is a4', () => {
      const a4Resume = cloneDeep(resume)
      a4Resume.layouts = [
        {
          engine: 'latex',
          page: {
            paperSize: 'a4',
          },
        },
      ]

      const renderer = new DeedyRenderer(a4Resume, layoutIndex)
      const result = renderer.renderPreamble()

      expect(result).toContain('\\documentclass[a4paper,')
    })

    it('should render letter paper size when paperSize is letter', () => {
      const letterResume = cloneDeep(resume)
      letterResume.layouts = [
        {
          engine: 'latex',
          page: {
            paperSize: 'letter',
          },
        },
      ]

      const renderer = new DeedyRenderer(letterResume, layoutIndex)
      const result = renderer.renderPreamble()

      expect(result).toContain('\\documentclass[letterpaper,')
    })

    it('should render Deedy template packages', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('\\usepackage{paracol}')
      expect(result).toContain('\\usepackage{titlesec}')
      expect(result).toContain('\\usepackage[usenames,dvipsnames]{xcolor}')
      expect(result).toContain('\\usepackage{enumitem}')
      expect(result).toContain('\\usepackage{changepage}')
      expect(result).toContain('\\usepackage[hidelinks]{hyperref}')
    })

    it('should define the Deedy accent color', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('\\definecolor{deedyprimary}')
    })

    it('should render custom resume commands', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('\\newcommand{\\resumeEntry}')
      expect(result).toContain('\\newcommand{\\resumeStack}')
    })

    it('should render section formatting with an accent titlerule', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('\\titleformat{\\section}')
      expect(result).toContain('\\titlerule')
      expect(result).toContain('\\color{deedyprimary}')
    })

    it('should use DEFAULT_LATEX_LAYOUT margins when no margins specified', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('geometry')
      expect(result).toContain('top=2.5cm')
      expect(result).toContain('bottom=2.5cm')
      expect(result).toContain('left=1.5cm')
      expect(result).toContain('right=1.5cm')
    })

    it('should use custom margins when specified', () => {
      resume.layouts = [
        {
          engine: 'latex',
          page: {
            margins: {
              top: '1cm',
              bottom: '2cm',
              left: '1.5cm',
              right: '1.5cm',
            },
          },
        },
      ]
      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPreamble()

      expect(result).toContain('top=1cm')
      expect(result).toContain('bottom=2cm')
    })

    it('should disable page numbers when showPageNumbers is false', () => {
      resume.layouts = [
        {
          engine: 'latex',
          page: {
            showPageNumbers: false,
          },
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPreamble()

      expect(result).toContain('\\pagenumbering{gobble}')
    })

    it('should include conditional fontawesome loading when showIcons is true (default)', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('\\IfFileExists{fontawesome7.sty}')
      expect(result).toContain('\\usepackage{fontawesome7}')
      expect(result).toContain('\\usepackage{fontawesome5}')
    })

    it('should not include fontawesome when showIcons is false', () => {
      resume.layouts = [
        {
          engine: 'latex',
          // @ts-ignore
          advanced: {
            showIcons: false,
          },
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPreamble()

      expect(result).not.toContain('fontawesome7')
      expect(result).not.toContain('fontawesome5')
      expect(result).not.toContain('\\IfFileExists')
    })

    it('should use default font size 11pt when typography.fontSize is empty', () => {
      resume.layouts = [
        {
          engine: 'latex',
          typography: {
            // @ts-ignore
            fontSize: '',
          },
        },
      ]
      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPreamble()
      expect(result).toContain('\\documentclass[a4paper,11pt]{article}')
    })

    it('should contain hypersetup for PDF metadata', () => {
      const result = renderer.renderPreamble()

      expect(result).toContain('\\hypersetup{')
      expect(result).toContain('pdftitle={')
      expect(result).toContain('pdfauthor={')
      expect(result).toContain('pdfsubject={')
      expect(result).toContain('pdfkeywords={')
    })
  })

  describe('renderBasics', () => {
    it('should render basic information with contact info', () => {
      const name = 'John Doe'
      const headline = 'Software Engineer'
      const phone = '123-456-7890'
      const email = 'john@example.com'
      const url = 'https://johndoe.com'

      resume.content.basics.name = name
      resume.content.basics.headline = headline
      resume.content.basics.phone = phone
      resume.content.basics.email = email
      resume.content.basics.url = url

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderBasics()

      expect(result).toContain(`\\textbf{\\Huge \\scshape ${name}}`)
      expect(result).toContain(`{\\Large ${headline}}`)
      expect(result).toContain('\\faPhoneVolume')
      expect(result).toContain(phone)
      expect(result).toContain('\\faEnvelope[regular]')
      expect(result).toContain(`\\href{mailto:${email}}{${email}}`)
      expect(result).toContain('\\faGlobe')
      expect(result).toContain(`\\url{${url}}`)
    })

    it('should NOT render name when name is empty', () => {
      resume.content.basics.name = ''

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderBasics()

      expect(result).toBe('')
    })

    it('should skip empty headline', () => {
      const name = 'John Doe'
      resume.content.basics.name = name
      resume.content.basics.headline = ''

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderBasics()

      expect(result).toContain(`\\textbf{\\Huge \\scshape ${name}}`)
      expect(result).not.toContain('\\Large }')
    })

    it('should handle undefined headline', () => {
      const name = 'John Doe'
      resume.content.basics.name = name
      resume.content.basics.headline = undefined

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderBasics()

      expect(result).toContain(`\\textbf{\\Huge \\scshape ${name}}`)
      expect(result).not.toContain('undefined')
    })
  })

  describe('renderLocation', () => {
    it('should render location when address exists', () => {
      const address = '123 Main St'
      const city = 'City'
      const country = 'Japan'

      resume.content.location = {
        address,
        city,
        country,
      }

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderLocation()

      expect(result).toContain(`${address}, ${city}, ${country}`)
      expect(result).toContain('\\faMapMarker')
    })
  })

  describe('renderProfiles', () => {
    it('should render one social profile', () => {
      const url = 'https://github.com/username'
      const username = 'username'

      resume.content.profiles = [
        {
          network: 'GitHub',
          url,
          username,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderProfiles()

      expect(result).toContain(`\\href{${url}}{${username}}`)
      expect(result).toContain('\\faGithub')
    })

    it('should NOT render icons if showIcons is false', () => {
      const url = 'https://github.com/username'
      const username = 'username'

      resume.content.profiles = [
        {
          network: 'GitHub',
          url,
          username,
        },
      ]

      resume.layouts[layoutIndex] = {
        ...resume.layouts[layoutIndex],
        // @ts-ignore
        advanced: {
          showIcons: false,
        },
      }

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderProfiles()

      expect(result).not.toContain('\\faGithub')
      expect(result).toContain(`\\href{${url}}{${username}}`)
    })

    it('should render multiple social profiles', () => {
      const githubUrl = 'https://github.com/username'
      const twitterUrl = 'https://twitter.com/username'
      const username = 'username'

      resume.content.profiles = [
        {
          network: 'GitHub',
          url: githubUrl,
          username,
        },
        {
          network: 'Twitter',
          url: twitterUrl,
          username,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderProfiles()

      expect(result).toContain('\\faGithub')
      expect(result).toContain('\\faTwitter')
    })

    it('should return empty string when there are no profiles', () => {
      resume.content.profiles = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderProfiles()

      expect(result).toBe('')
    })
  })

  describe('renderSummary', () => {
    it('should render the summary section', () => {
      resume.content.basics.summary = 'A short summary.'

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderSummary()
      const sectionName = renderer.resume.content.computed?.sectionNames?.basics

      expect(result).toContain(`\\section{${sectionName}}`)
      expect(result).toContain('A short summary.')
    })

    it('should return empty string when summary is empty', () => {
      resume.content.basics.summary = ''

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderSummary()

      expect(result).toBe('')
    })
  })

  describe('renderEducation', () => {
    it('should render education section', () => {
      const institution = 'University'
      const area = 'Computer Science'
      const degree = 'Bachelor'
      const startDate = 'Jan 1, 2020'
      const endDate = 'Jan 1, 2024'
      const url = 'https://university.edu'
      const summary = ''

      resume.content.education = [
        {
          institution,
          area,
          degree,
          startDate,
          endDate,
          url,
          summary,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderEducation()

      expect(result).toMatch(/^\\section{Education}/)
      expect(result).toContain('\\resumeStack')
      expect(result).toContain(institution)
      expect(result).toContain(`\\href{${url}}{${institution}}`)
    })

    it('should return empty string when there is no education', () => {
      resume.content.education = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderEducation()

      expect(result).toBe('')
    })
  })

  describe('renderWork', () => {
    it('should render work section', () => {
      const name = 'Company'
      const position = 'Software Engineer'
      const startDate = 'Jan 1, 2020'
      const endDate = 'Jan 1, 2024'
      const url = 'https://company.com'
      const summary = ''
      const keywords = ['JavaScript', 'TypeScript']

      resume.content.work = [
        {
          name,
          position,
          startDate,
          endDate,
          url,
          summary,
          keywords,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderWork()

      expect(result).toMatch(/^\\section{Work}/)
      expect(result).toContain('\\resumeEntry')
      expect(result).toContain(`{${position}}`)
      expect(result).toContain(`{${name}}`)
      expect(result).toContain(`\\href{${url}}{${url}}`)
    })

    it('should return empty string when there is no work', () => {
      resume.content.work = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderWork()

      expect(result).toBe('')
    })
  })

  describe('renderLanguages', () => {
    it('should render languages section', () => {
      resume.content.languages = [
        {
          language: 'English',
          fluency: 'Native or Bilingual Proficiency',
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderLanguages()

      expect(result).toMatch(/^\\section{Languages}/)
      expect(result).toContain('\\textbf{English}')
      expect(result).toContain('Native or Bilingual Proficiency')
    })

    it('should return empty string when there are no languages', () => {
      resume.content.languages = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderLanguages()

      expect(result).toBe('')
    })
  })

  describe('renderSkills', () => {
    it('should render skills section with keywords', () => {
      resume.content.skills = [
        {
          name: 'Programming',
          level: 'Expert',
          keywords: ['JavaScript', 'TypeScript'],
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderSkills()

      expect(result).toMatch(/^\\section{Skills}/)
      expect(result).toContain('\\textbf{Programming}')
    })

    it('should render skills section without keywords', () => {
      resume.content.skills = [
        {
          name: 'Programming',
          level: 'Expert',
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderSkills()

      expect(result).toMatch(/^\\section{Skills}/)
      expect(result).toContain('\\textbf{Programming}')
    })

    it('should return empty string when there are no skills', () => {
      resume.content.skills = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderSkills()

      expect(result).toBe('')
    })
  })

  describe('renderAwards', () => {
    it('should render awards section', () => {
      const title = 'Best Developer Award'
      const awarder = 'Tech Company'
      const date = 'Jan 1, 2023'
      const summary = ''

      resume.content.awards = [
        {
          title,
          awarder,
          date,
          summary,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderAwards()

      expect(result).toMatch(/^\\section{Awards}/)
      expect(result).toContain('\\resumeEntry')
      expect(result).toContain(`{${title}}`)
      expect(result).toContain(`{${awarder}}`)
    })

    it('should return empty string when there are no awards', () => {
      resume.content.awards = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderAwards()

      expect(result).toBe('')
    })
  })

  describe('renderCertificates', () => {
    it('should render certificates section', () => {
      const name = 'AWS Certified Solutions Architect'
      const issuer = 'Amazon Web Services'
      const date = 'Jan 1, 2023'
      const url = 'https://aws.amazon.com/certification'

      resume.content.certificates = [
        {
          name,
          issuer,
          date,
          url,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderCertificates()

      expect(result).toMatch(/^\\section{Certificates}/)
      expect(result).toContain('\\resumeStack')
      expect(result).toContain(`\\href{${url}}{${name}}`)
      expect(result).toContain(`{${issuer}}`)
    })

    it('should return empty string when there are no certificates', () => {
      resume.content.certificates = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderCertificates()

      expect(result).toBe('')
    })
  })

  describe('renderPublications', () => {
    it('should render publications section', () => {
      const name = 'Research Paper Title'
      const publisher = 'Academic Journal'
      const releaseDate = 'Jan 1, 2023'
      const url = 'https://journal.com/paper'
      const summary = ''

      resume.content.publications = [
        {
          name,
          publisher,
          releaseDate,
          url,
          summary,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPublications()

      expect(result).toMatch(/^\\section{Publications}/)
      expect(result).toContain('\\resumeEntry')
      expect(result).toContain(`{${name}}`)
      expect(result).toContain(`{${publisher}}`)
      expect(result).toContain(`\\href{${url}}{${url}}`)
    })

    it('should return empty string when there are no publications', () => {
      resume.content.publications = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderPublications()

      expect(result).toBe('')
    })
  })

  describe('renderReferences', () => {
    it('should render references section', () => {
      const name = 'John Smith'
      const email = 'john@example.com'
      const phone = '+1234567890'
      const relationship = 'Manager'
      const summary = ''

      resume.content.references = [
        {
          name,
          email,
          phone,
          relationship,
          summary,
          computed: {
            summary,
          },
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderReferences()

      expect(result).toMatch(/^\\section{References}/)
      expect(result).toContain('\\resumeEntry')
      expect(result).toContain(`{${name}}`)
      expect(result).toContain(`{${relationship}}`)
    })

    it('should return empty string when there are no references', () => {
      resume.content.references = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderReferences()

      expect(result).toBe('')
    })
  })

  describe('renderProjects', () => {
    it('should render projects section', () => {
      const name = 'Project Name'
      const description = 'Project Description'
      const startDate = 'Jan 1, 2023'
      const endDate = 'Dec 31, 2023'
      const url = 'https://project.com'
      const summary = ''
      const keywords = ['React', 'TypeScript']

      resume.content.projects = [
        {
          name,
          description,
          startDate,
          endDate,
          url,
          summary,
          keywords,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderProjects()

      expect(result).toMatch(/^\\section{Projects}/)
      expect(result).toContain('\\resumeEntry')
      expect(result).toContain(name)
      expect(result).toContain('Keywords')
      expect(result).toContain('React, TypeScript')
    })

    it('should return empty string when there are no projects', () => {
      resume.content.projects = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderProjects()

      expect(result).toBe('')
    })
  })

  describe('renderInterests', () => {
    it('should render interests section', () => {
      const name = 'Programming'
      const keywords = ['Open Source', 'Web Development']

      resume.content.interests = [
        {
          name,
          keywords,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderInterests()

      expect(result).toMatch(/^\\section{Interests}/)
      expect(result).toContain(`\\textbf{${name}}`)
    })

    it('should return empty string when there are no interests', () => {
      resume.content.interests = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderInterests()

      expect(result).toBe('')
    })
  })

  describe('renderVolunteer', () => {
    it('should render volunteer section', () => {
      const organization = 'Code for Good'
      const position = 'Technical Lead'
      const startDate = '2023-01'
      const endDate = '2023-12'
      const summary = ''
      const url = 'https://codeforgood.org'

      resume.content.volunteer = [
        {
          organization,
          position,
          startDate,
          endDate,
          url,
          summary,
        },
      ]

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderVolunteer()

      expect(result).toMatch(/^\\section{Volunteer}/)
      expect(result).toContain('\\resumeEntry')
      expect(result).toContain(`{${position}}`)
      expect(result).toContain(`{${organization}}`)
      expect(result).toContain(`\\href{${url}}{${url}}`)
    })

    it('should return empty string when there is no volunteer', () => {
      resume.content.volunteer = []

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.renderVolunteer()

      expect(result).toBe('')
    })
  })

  describe('generateTeX', () => {
    it('should place secondary sections in the left column and primary in the right', () => {
      const result = renderer.render()

      const paracolStart = result.indexOf('\\begin{paracol}{2}')
      const switchIndex = result.indexOf('\\switchcolumn')
      const paracolEnd = result.indexOf('\\end{paracol}')

      expect(paracolStart).toBeGreaterThan(-1)
      expect(switchIndex).toBeGreaterThan(paracolStart)
      expect(paracolEnd).toBeGreaterThan(switchIndex)

      const leftColumn = result.slice(paracolStart, switchIndex)
      const rightColumn = result.slice(switchIndex, paracolEnd)

      const { sectionNames } = renderer.resume.content.computed ?? {}

      // left column carries education and skills
      expect(leftColumn).toContain(`\\section{${sectionNames?.education}}`)
      expect(leftColumn).toContain(`\\section{${sectionNames?.skills}}`)

      // right column carries work and projects
      expect(rightColumn).toContain(`\\section{${sectionNames?.work}}`)
      expect(rightColumn).toContain(`\\section{${sectionNames?.projects}}`)
    })

    it('should render the header block with basics before paracol', () => {
      const name = 'John Doe'
      resume.content.basics.name = name

      renderer = new DeedyRenderer(resume, layoutIndex)
      const result = renderer.render()

      const nameIndex = result.indexOf(name)
      const paracolStart = result.indexOf('\\begin{paracol}{2}')

      expect(nameIndex).toBeGreaterThan(-1)
      expect(nameIndex).toBeLessThan(paracolStart)
    })
  })
})
