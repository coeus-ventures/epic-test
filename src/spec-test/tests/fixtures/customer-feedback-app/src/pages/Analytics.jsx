import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function Analytics() {
  const [surveys, setSurveys] = useState([])

  useEffect(() => {
    const stored = localStorage.getItem('surveys')
    if (stored) {
      const allSurveys = JSON.parse(stored)
      const surveysWithResponses = allSurveys.map(s => {
        const responses = JSON.parse(localStorage.getItem(`responses_${s.id}`) || '[]')
        return { ...s, responseCount: responses.length }
      })
      setSurveys(surveysWithResponses)
    }
  }, [])

  const totalResponses = surveys.reduce((sum, s) => sum + s.responseCount, 0)

  return (
    <div className="container">
      <Link to="/surveys" style={{ display: 'inline-block', marginBottom: 16 }}>← Back to Surveys</Link>
      <h1>Analytics</h1>

      <div style={{ marginTop: 16 }}>
        <h2>Response Summary</h2>
        <p style={{ fontSize: 18 }}>Total Responses: <strong>{totalResponses}</strong></p>
      </div>

      {surveys.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Surveys</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {surveys.map(s => (
              <li key={s.id} style={{ padding: 12, border: '1px solid #eee', borderRadius: 4, marginBottom: 8 }}>
                <Link to={`/surveys/${s.id}`}><strong>{s.title}</strong></Link>
                <p style={{ margin: '4px 0 0', color: '#666' }}>{s.responseCount} responses</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
