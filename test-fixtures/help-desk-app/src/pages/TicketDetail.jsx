import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function TicketDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [ticket, setTicket] = useState(null)
  const [assignee, setAssignee] = useState('')
  const [status, setStatus] = useState('')
  const [replyText, setReplyText] = useState('')
  const [replies, setReplies] = useState([])
  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [notes, setNotes] = useState([])

  useEffect(() => {
    const stored = localStorage.getItem('tickets')
    if (stored) {
      const tickets = JSON.parse(stored)
      const found = tickets.find(t => t.id === id)
      if (found) {
        setTicket(found)
        setAssignee(found.assignee || '')
        setStatus(found.status || 'Open')
        setReplies(found.replies || [])
        setNotes(found.notes || [])
      }
    }
  }, [id])

  function handleSendReply() {
    if (!replyText.trim()) return
    const newReply = { text: replyText, createdAt: new Date().toISOString() }
    const updatedReplies = [...replies, newReply]
    setReplies(updatedReplies)
    setReplyText('')

    const stored = localStorage.getItem('tickets')
    if (stored) {
      const tickets = JSON.parse(stored)
      const idx = tickets.findIndex(t => t.id === id)
      if (idx !== -1) {
        tickets[idx] = { ...tickets[idx], replies: updatedReplies }
        localStorage.setItem('tickets', JSON.stringify(tickets))
        setTicket(tickets[idx])
      }
    }
  }

  function handleSave() {
    const stored = localStorage.getItem('tickets')
    if (stored) {
      const tickets = JSON.parse(stored)
      const idx = tickets.findIndex(t => t.id === id)
      if (idx !== -1) {
        tickets[idx] = { ...tickets[idx], assignee, status }
        localStorage.setItem('tickets', JSON.stringify(tickets))
        setTicket(tickets[idx])
      }
    }
  }

  function handleResolve() {
    const stored = localStorage.getItem('tickets')
    if (stored) {
      const tickets = JSON.parse(stored)
      const idx = tickets.findIndex(t => t.id === id)
      if (idx !== -1) {
        tickets[idx] = { ...tickets[idx], status: 'Resolved' }
        localStorage.setItem('tickets', JSON.stringify(tickets))
        setTicket(tickets[idx])
        setStatus('Resolved')
      }
    }
  }

  function handleSaveNote() {
    if (!noteText.trim()) return
    const newNote = { text: noteText, createdAt: new Date().toISOString() }
    const updatedNotes = [...notes, newNote]
    setNotes(updatedNotes)
    setNoteText('')
    setShowNoteForm(false)

    const stored = localStorage.getItem('tickets')
    if (stored) {
      const tickets = JSON.parse(stored)
      const idx = tickets.findIndex(t => t.id === id)
      if (idx !== -1) {
        tickets[idx] = { ...tickets[idx], notes: updatedNotes }
        localStorage.setItem('tickets', JSON.stringify(tickets))
        setTicket(tickets[idx])
      }
    }
  }

  if (!ticket) {
    return <div style={{ padding: 24 }}>Ticket not found.</div>
  }

  return (
    <div style={{ padding: 24 }}>
      <nav style={{ marginBottom: 16 }}>
        <button onClick={() => navigate('/tickets')} style={{ cursor: 'pointer', padding: '8px 16px' }}>
          Tickets
        </button>
      </nav>

      <h1>{ticket.subject}</h1>
      <p>{ticket.description}</p>

      <div style={{ marginTop: 8, marginBottom: 16 }}>
        <strong>Status:</strong> <span>{ticket.status}</span>
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="assignee" style={{ display: 'block', marginBottom: 4 }}>Assignee</label>
          <select
            id="assignee"
            value={assignee}
            onChange={e => setAssignee(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          >
            <option value="">Unassigned</option>
            <option value="Agent Smith">Agent Smith</option>
            <option value="Agent Johnson">Agent Johnson</option>
            <option value="Agent Brown">Agent Brown</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label htmlFor="status" style={{ display: 'block', marginBottom: 4 }}>Status</label>
          <select
            id="status"
            value={status}
            onChange={e => setStatus(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          >
            <option value="Open">Open</option>
            <option value="In Progress">In Progress</option>
            <option value="Resolved">Resolved</option>
            <option value="Closed">Closed</option>
          </select>
        </div>

        <button onClick={handleSave} style={{ padding: '8px 24px', cursor: 'pointer' }}>
          Save
        </button>
        <button onClick={handleResolve} style={{ padding: '8px 24px', cursor: 'pointer', marginLeft: 8, background: '#4caf50', color: 'white', border: 'none', borderRadius: 4 }}>
          Resolve
        </button>
      </div>

      {ticket.assignee && (
        <div style={{ marginTop: 16 }}>
          <strong>Assigned to:</strong> {ticket.assignee}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <h2>Replies</h2>
        {replies.map((reply, i) => (
          <div key={i} style={{ padding: 12, marginBottom: 8, background: '#f5f5f5', borderRadius: 4 }}>
            <p>{reply.text}</p>
            <small style={{ color: '#888' }}>{new Date(reply.createdAt).toLocaleString()}</small>
          </div>
        ))}
        <div style={{ marginTop: 12 }}>
          <label htmlFor="reply" style={{ display: 'block', marginBottom: 4 }}>Reply</label>
          <textarea
            id="reply"
            placeholder="Type your reply..."
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            style={{ width: '100%', padding: 8, minHeight: 80 }}
          />
          <button onClick={handleSendReply} style={{ marginTop: 8, padding: '8px 24px', cursor: 'pointer' }}>
            Send Reply
          </button>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2>Internal Notes</h2>
        {notes.map((note, i) => (
          <div key={i} style={{ padding: 12, marginBottom: 8, background: '#fff3cd', borderRadius: 4, borderLeft: '4px solid #ffc107' }}>
            <p>{note.text}</p>
            <small style={{ color: '#888' }}>{new Date(note.createdAt).toLocaleString()}</small>
          </div>
        ))}
        {!showNoteForm ? (
          <button onClick={() => setShowNoteForm(true)} style={{ marginTop: 8, padding: '8px 24px', cursor: 'pointer' }}>
            Add Internal Note
          </button>
        ) : (
          <div style={{ marginTop: 12 }}>
            <label htmlFor="note" style={{ display: 'block', marginBottom: 4 }}>Note</label>
            <textarea
              id="note"
              placeholder="Type your note..."
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              style={{ width: '100%', padding: 8, minHeight: 80 }}
            />
            <button onClick={handleSaveNote} style={{ marginTop: 8, padding: '8px 24px', cursor: 'pointer' }}>
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
