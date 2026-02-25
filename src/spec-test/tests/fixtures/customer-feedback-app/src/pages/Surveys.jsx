import { useState, useEffect } from 'react'
import { useAuth } from '../AuthContext'
import { useNavigate, Link } from 'react-router-dom'

export default function Surveys() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [surveys, setSurveys] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  useEffect(() => {
    const stored = localStorage.getItem('surveys')
    if (stored) {
      setSurveys(JSON.parse(stored))
    }
  }, [])

  function handleSignOut() {
    signOut()
    navigate('/sign-in')
  }

  function handleSave() {
    const newSurvey = {
      id: Date.now().toString(),
      title,
      description,
      status: 'active',
      createdAt: new Date().toISOString()
    }
    const updated = [...surveys, newSurvey]
    setSurveys(updated)
    localStorage.setItem('surveys', JSON.stringify(updated))
    setTitle('')
    setDescription('')
    setShowForm(false)
  }

  function handleDelete(id) {
    const updated = surveys.filter(s => s.id !== id)
    setSurveys(updated)
    localStorage.setItem('surveys', JSON.stringify(updated))
    setDeleteTarget(null)
  }

  function handleArchive(id) {
    const updated = surveys.map(s => s.id === id ? { ...s, status: 'archived' } : s)
    setSurveys(updated)
    localStorage.setItem('surveys', JSON.stringify(updated))
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Surveys</h1>
        <button onClick={handleSignOut}>Sign Out</button>
      </div>
      <p>Welcome, {user?.name}!</p>

      {!showForm && (
        <button style={{ marginTop: 16 }} onClick={() => setShowForm(true)}>
          Create Survey
        </button>
      )}

      {showForm && (
        <div style={{ marginTop: 16, padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
          <h2>New Survey</h2>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="survey-title">Title</label>
            <input
              id="survey-title"
              type="text"
              placeholder="Survey title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="survey-description">Description</label>
            <input
              id="survey-description"
              type="text"
              placeholder="Description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
            />
          </div>
          <button onClick={handleSave}>Save</button>
          <button onClick={() => setShowForm(false)} style={{ marginLeft: 8 }}>Cancel</button>
        </div>
      )}

      {surveys.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Your Surveys</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {surveys.map(s => (
              <li key={s.id} style={{ padding: 12, border: '1px solid #eee', borderRadius: 4, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <Link to={`/surveys/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <strong>{s.title}</strong>
                  </Link>
                  {s.status === 'archived' && <span style={{ marginLeft: 8, color: '#888', fontStyle: 'italic' }}>Archived</span>}
                  {s.description && <p style={{ margin: '4px 0 0', color: '#666' }}>{s.description}</p>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {s.status !== 'archived' && (
                    <button onClick={() => handleArchive(s.id)} aria-label={`Archive ${s.title}`} style={{ color: '#666', background: 'none', border: '1px solid #666', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}>
                      Archive
                    </button>
                  )}
                  <button onClick={() => setDeleteTarget(s)} aria-label={`Delete ${s.title}`} style={{ color: 'red', background: 'none', border: '1px solid red', borderRadius: 4, padding: '4px 8px', cursor: 'pointer' }}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {deleteTarget && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} role="dialog" aria-modal="true">
          <div style={{ background: 'white', padding: 24, borderRadius: 8, maxWidth: 400, width: '90%' }}>
            <h3>Delete Survey</h3>
            <p>Are you sure you want to delete "{deleteTarget.title}"?</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button onClick={() => handleDelete(deleteTarget.id)} style={{ background: 'red', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 4, cursor: 'pointer' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
