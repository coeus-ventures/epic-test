import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'

export default function SurveyDetail() {
  const { id } = useParams()
  const [survey, setSurvey] = useState(null)
  const [questions, setQuestions] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [questionType, setQuestionType] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [takingSurvey, setTakingSurvey] = useState(false)
  const [responses, setResponses] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [activeTab, setActiveTab] = useState('questions')
  const [surveyResponses, setSurveyResponses] = useState([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [exportMessage, setExportMessage] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('surveys')
    if (stored) {
      const surveys = JSON.parse(stored)
      const found = surveys.find(s => s.id === id)
      if (found) setSurvey(found)
    }
    const storedQuestions = localStorage.getItem(`questions_${id}`)
    if (storedQuestions) {
      setQuestions(JSON.parse(storedQuestions))
    }
    const storedResponses = localStorage.getItem(`responses_${id}`)
    if (storedResponses) {
      setSurveyResponses(JSON.parse(storedResponses))
    }
  }, [id])

  function handleSave() {
    const newQuestion = {
      id: Date.now().toString(),
      type: questionType,
      text: questionText,
      createdAt: new Date().toISOString()
    }
    if (questionType === 'Multiple Choice') {
      newQuestion.options = options.filter(o => o.trim() !== '')
    }
    const updated = [...questions, newQuestion]
    setQuestions(updated)
    localStorage.setItem(`questions_${id}`, JSON.stringify(updated))
    setQuestionType('')
    setQuestionText('')
    setOptions(['', ''])
    setShowForm(false)
  }

  if (!survey) {
    return (
      <div className="container">
        <p>Survey not found.</p>
        <Link to="/surveys">Back to Surveys</Link>
      </div>
    )
  }

  return (
    <div className="container">
      <Link to="/surveys" style={{ display: 'inline-block', marginBottom: 16 }}>← Back to Surveys</Link>
      <h1>{survey.title}</h1>
      {survey.description && <p style={{ color: '#666' }}>{survey.description}</p>}

      <div style={{ display: 'flex', gap: 0, marginTop: 16, borderBottom: '2px solid #e5e7eb' }}>
        <button
          onClick={() => setActiveTab('questions')}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderBottom: activeTab === 'questions' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'questions' ? 'bold' : 'normal',
            color: activeTab === 'questions' ? '#2563eb' : '#666'
          }}
        >
          Questions
        </button>
        <button
          onClick={() => {
            setActiveTab('results')
            const storedResponses = localStorage.getItem(`responses_${id}`)
            if (storedResponses) {
              setSurveyResponses(JSON.parse(storedResponses))
            }
          }}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderBottom: activeTab === 'results' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'results' ? 'bold' : 'normal',
            color: activeTab === 'results' ? '#2563eb' : '#666'
          }}
        >
          Results
        </button>
        <button
          onClick={() => {
            setActiveTab('analytics')
            const storedResponses = localStorage.getItem(`responses_${id}`)
            if (storedResponses) {
              setSurveyResponses(JSON.parse(storedResponses))
            }
          }}
          style={{
            padding: '8px 16px',
            border: 'none',
            borderBottom: activeTab === 'analytics' ? '2px solid #2563eb' : '2px solid transparent',
            background: 'none',
            cursor: 'pointer',
            fontWeight: activeTab === 'analytics' ? 'bold' : 'normal',
            color: activeTab === 'analytics' ? '#2563eb' : '#666'
          }}
        >
          Analytics
        </button>
      </div>

      {activeTab === 'results' && (() => {
        const filteredResponses = surveyResponses.filter(r => {
          if (!r.submittedAt) return true
          const responseDate = r.submittedAt.split('T')[0]
          if (startDate && responseDate < startDate) return false
          if (endDate && responseDate > endDate) return false
          return true
        })

        function handleExport() {
          const headers = ['Submitted At', ...questions.map(q => q.text)]
          const rows = filteredResponses.map(r => {
            return [
              r.submittedAt ? new Date(r.submittedAt).toLocaleString() : '',
              ...questions.map(q => r.responses[q.id] !== undefined ? String(r.responses[q.id]) : '')
            ]
          })
          const csvContent = [headers, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = `${survey.title || 'survey'}-responses.csv`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)
          setExportMessage('Responses exported successfully!')
          setTimeout(() => setExportMessage(''), 5000)
        }

        return (
          <div style={{ marginTop: 24 }}>
            <h2>Response Summary</h2>
            <p style={{ fontSize: 18 }}>Total Responses: <strong>{surveyResponses.length}</strong></p>

            <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12 }}>
              <button
                onClick={handleExport}
                style={{
                  padding: '8px 16px',
                  background: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                Export
              </button>
              {exportMessage && (
                <span role="alert" style={{ color: '#16a34a', fontWeight: 'bold' }}>{exportMessage}</span>
              )}
            </div>

            <div style={{ marginTop: 16, padding: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <h3 style={{ marginTop: 0 }}>Filter by Date</h3>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <div>
                  <label htmlFor="start-date" style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>Start Date</label>
                  <input
                    id="start-date"
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                  />
                </div>
                <div>
                  <label htmlFor="end-date" style={{ display: 'block', fontSize: 14, marginBottom: 4 }}>End Date</label>
                  <input
                    id="end-date"
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                    style={{ padding: 8, border: '1px solid #ccc', borderRadius: 4 }}
                  />
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 16 }}>Showing <strong>{filteredResponses.length}</strong> of {surveyResponses.length} responses</p>
              {filteredResponses.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: 0 }}>
                  {filteredResponses.map((r, idx) => (
                    <li key={r.id || idx} style={{ padding: 12, border: '1px solid #eee', borderRadius: 4, marginBottom: 8 }}>
                      <p style={{ margin: 0, fontSize: 14, color: '#666' }}>
                        Submitted: {new Date(r.submittedAt).toLocaleDateString()}
                      </p>
                      {questions.map(q => (
                        <div key={q.id} style={{ marginTop: 8 }}>
                          <p style={{ margin: 0, fontSize: 13, color: '#999' }}>{q.text}</p>
                          <p style={{ margin: '2px 0 0', fontWeight: 'bold' }}>
                            {r.responses[q.id] !== undefined ? String(r.responses[q.id]) : '—'}
                          </p>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: '#64748b' }}>No responses match the selected date range.</p>
              )}
            </div>
          </div>
        )
      })()}

      {activeTab === 'analytics' && (() => {
        const npsQuestions = questions.filter(q => q.type === 'NPS')
        const npsScores = []
        surveyResponses.forEach(r => {
          npsQuestions.forEach(q => {
            const score = r.responses[q.id]
            if (score !== undefined && score !== null) {
              npsScores.push(Number(score))
            }
          })
        })
        const total = npsScores.length
        const promoters = npsScores.filter(s => s >= 9).length
        const passives = npsScores.filter(s => s >= 7 && s <= 8).length
        const detractors = npsScores.filter(s => s <= 6).length
        const npsScore = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0

        return (
          <div style={{ marginTop: 24 }}>
            <h2>NPS Analytics</h2>
            <div style={{ padding: 20, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 16 }}>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 4 }}>NPS Score</p>
              <p style={{ fontSize: 48, fontWeight: 'bold', color: npsScore >= 0 ? '#16a34a' : '#dc2626', margin: 0 }}>{npsScore}</p>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 120, padding: 16, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
                <p style={{ fontSize: 14, color: '#166534', marginBottom: 4 }}>Promoters (9-10)</p>
                <p style={{ fontSize: 24, fontWeight: 'bold', color: '#166534', margin: 0 }}>{promoters}</p>
                {total > 0 && <p style={{ fontSize: 12, color: '#166534', margin: '4px 0 0' }}>{Math.round((promoters / total) * 100)}%</p>}
              </div>
              <div style={{ flex: 1, minWidth: 120, padding: 16, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8 }}>
                <p style={{ fontSize: 14, color: '#92400e', marginBottom: 4 }}>Passives (7-8)</p>
                <p style={{ fontSize: 24, fontWeight: 'bold', color: '#92400e', margin: 0 }}>{passives}</p>
                {total > 0 && <p style={{ fontSize: 12, color: '#92400e', margin: '4px 0 0' }}>{Math.round((passives / total) * 100)}%</p>}
              </div>
              <div style={{ flex: 1, minWidth: 120, padding: 16, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8 }}>
                <p style={{ fontSize: 14, color: '#991b1b', marginBottom: 4 }}>Detractors (0-6)</p>
                <p style={{ fontSize: 24, fontWeight: 'bold', color: '#991b1b', margin: 0 }}>{detractors}</p>
                {total > 0 && <p style={{ fontSize: 12, color: '#991b1b', margin: '4px 0 0' }}>{Math.round((detractors / total) * 100)}%</p>}
              </div>
            </div>
            {total === 0 && <p style={{ color: '#64748b', marginTop: 16 }}>No NPS responses yet. Add an NPS question and collect responses to see analytics.</p>}
          </div>
        )
      })()}

      {activeTab === 'questions' && !showForm && (
        <button style={{ marginTop: 16 }} onClick={() => setShowForm(true)}>
          Add Question
        </button>
      )}

      {activeTab === 'questions' && showForm && (
        <div style={{ marginTop: 16, padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
          <h2>New Question</h2>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="question-type">Question Type</label>
            <select
              id="question-type"
              value={questionType}
              onChange={e => setQuestionType(e.target.value)}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            >
              <option value="">Select type...</option>
              <option value="NPS">NPS</option>
              <option value="Text">Text</option>
              <option value="Multiple Choice">Multiple Choice</option>
            </select>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="question-text">Question</label>
            <input
              id="question-text"
              type="text"
              placeholder="Enter your question"
              value={questionText}
              onChange={e => setQuestionText(e.target.value)}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
          {questionType === 'Multiple Choice' && (
            <div style={{ marginBottom: 12 }}>
              <label>Options</label>
              {options.map((opt, idx) => (
                <div key={idx} style={{ marginTop: 4 }}>
                  <input
                    type="text"
                    placeholder={`Option ${idx + 1}`}
                    value={opt}
                    onChange={e => {
                      const updated = [...options]
                      updated[idx] = e.target.value
                      setOptions(updated)
                    }}
                    aria-label={`Option ${idx + 1}`}
                    style={{ display: 'block', width: '100%', padding: 8 }}
                  />
                </div>
              ))}
              <button type="button" onClick={() => setOptions([...options, ''])} style={{ marginTop: 8, fontSize: 12 }}>
                Add Option
              </button>
            </div>
          )}
          <button onClick={handleSave}>Save</button>
          <button onClick={() => { setShowForm(false); setQuestionType(''); setQuestionText(''); setOptions(['', '']) }} style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      )}

      {activeTab === 'questions' && questions.length > 0 && !takingSurvey && !submitted && (
        <div style={{ marginTop: 24 }}>
          <h2>Questions</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {questions.map(q => (
              <li key={q.id} style={{ padding: 12, border: '1px solid #eee', borderRadius: 4, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#999', textTransform: 'uppercase' }}>{q.type}</span>
                <p style={{ margin: '4px 0 0' }}>{q.text}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeTab === 'questions' && questions.length > 0 && !takingSurvey && !submitted && (
        <button style={{ marginTop: 16 }} onClick={() => setTakingSurvey(true)}>
          Take Survey
        </button>
      )}

      {activeTab === 'questions' && takingSurvey && !submitted && (
        <div style={{ marginTop: 24 }}>
          <h2>Take Survey</h2>
          {questions.map(q => (
            <div key={q.id} style={{ marginBottom: 20, padding: 16, border: '1px solid #eee', borderRadius: 8 }}>
              <p style={{ fontWeight: 'bold', marginBottom: 8 }}>{q.text}</p>
              {q.type === 'NPS' && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setResponses(prev => ({ ...prev, [q.id]: score }))}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 4,
                        border: responses[q.id] === score ? '2px solid #2563eb' : '1px solid #ccc',
                        background: responses[q.id] === score ? '#2563eb' : '#fff',
                        color: responses[q.id] === score ? '#fff' : '#333',
                        cursor: 'pointer',
                        fontWeight: responses[q.id] === score ? 'bold' : 'normal'
                      }}
                      aria-label={`Score ${score}`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              )}
              {q.type === 'Text' && (
                <textarea
                  placeholder="Your answer..."
                  value={responses[q.id] || ''}
                  onChange={e => setResponses(prev => ({ ...prev, [q.id]: e.target.value }))}
                  style={{ width: '100%', padding: 8, minHeight: 60 }}
                />
              )}
              {q.type === 'Multiple Choice' && q.options && (
                <div>
                  {q.options.map((opt, idx) => (
                    <label key={idx} style={{ display: 'block', marginBottom: 4, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name={`mc_${q.id}`}
                        value={opt}
                        checked={responses[q.id] === opt}
                        onChange={() => setResponses(prev => ({ ...prev, [q.id]: opt }))}
                      />
                      {' '}{opt}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button onClick={() => {
            const responseData = {
              id: Date.now().toString(),
              surveyId: id,
              responses: { ...responses },
              submittedAt: new Date().toISOString()
            }
            const key = `responses_${id}`
            const existing = JSON.parse(localStorage.getItem(key) || '[]')
            existing.push(responseData)
            localStorage.setItem(key, JSON.stringify(existing))
            setSurveyResponses(existing)
            setSubmitted(true)
            setTakingSurvey(false)
          }}>
            Submit
          </button>
          <button onClick={() => { setTakingSurvey(false); setResponses({}) }} style={{ marginLeft: 8 }}>
            Cancel
          </button>
        </div>
      )}

      {activeTab === 'questions' && submitted && (
        <div style={{ marginTop: 24, padding: 16, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }} role="alert">
          <p style={{ color: '#166534', fontWeight: 'bold' }}>Thank you! Your response has been submitted successfully.</p>
          <button onClick={() => { setSubmitted(false); setResponses({}) }} style={{ marginTop: 8 }}>
            Back to Survey
          </button>
        </div>
      )}
    </div>
  )
}
