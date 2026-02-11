import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function Tickets() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [showForm, setShowForm] = useState(false)
  const [tickets, setTickets] = useState([])
  const [subject, setSubject] = useState('')
  const [description, setDescription] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [priority, setPriority] = useState('Medium')
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const stored = localStorage.getItem('tickets')
    if (stored) {
      setTickets(JSON.parse(stored))
    }
  }, [])

  const filteredTickets = tickets.filter(t => {
    if (statusFilter && t.status !== statusFilter) return false
    if (priorityFilter && t.priority !== priorityFilter) return false
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      if (!t.subject.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false
    }
    return true
  })

  function handleSignOut() {
    signOut()
    navigate('/sign-in')
  }

  function handleSubmit(e) {
    e.preventDefault()
    const newTicket = {
      id: Date.now().toString(),
      subject,
      description,
      customerEmail,
      priority,
      status: 'Open',
      createdAt: new Date().toISOString(),
      createdBy: user?.email
    }
    const updated = [...tickets, newTicket]
    setTickets(updated)
    localStorage.setItem('tickets', JSON.stringify(updated))
    setSubject('')
    setDescription('')
    setCustomerEmail('')
    setPriority('Medium')
    setShowForm(false)
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Tickets</h1>
        <div>
          <span style={{ marginRight: 16 }}>{user?.name}</span>
          <button onClick={handleSignOut} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 16 }}>
        <button
          onClick={() => setShowForm(true)}
          style={{ padding: '8px 24px', cursor: 'pointer' }}
        >
          New Ticket
        </button>
        <select
          aria-label="Status filter"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value="">All Statuses</option>
          <option value="Open">Open</option>
          <option value="In Progress">In Progress</option>
          <option value="Resolved">Resolved</option>
          <option value="Closed">Closed</option>
        </select>
        <select
          aria-label="Priority filter"
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
          style={{ padding: 8 }}
        >
          <option value="">All Priorities</option>
          <option value="Low">Low</option>
          <option value="Medium">Medium</option>
          <option value="High">High</option>
          <option value="Urgent">Urgent</option>
        </select>
        <input
          type="text"
          placeholder="Search tickets..."
          aria-label="Search"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ padding: 8 }}
        />
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} style={{ marginBottom: 24, padding: 16, border: '1px solid #ccc', borderRadius: 4 }}>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="subject" style={{ display: 'block', marginBottom: 4 }}>Subject</label>
            <input
              id="subject"
              type="text"
              placeholder="Subject"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              required
              style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="description" style={{ display: 'block', marginBottom: 4 }}>Description</label>
            <textarea
              id="description"
              placeholder="Description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              style={{ width: '100%', padding: 8, minHeight: 80, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="customerEmail" style={{ display: 'block', marginBottom: 4 }}>Customer Email</label>
            <input
              id="customerEmail"
              type="email"
              placeholder="Customer Email"
              value={customerEmail}
              onChange={e => setCustomerEmail(e.target.value)}
              required
              style={{ width: '100%', padding: 8, boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="priority" style={{ display: 'block', marginBottom: 4 }}>Priority</label>
            <select
              id="priority"
              value={priority}
              onChange={e => setPriority(e.target.value)}
              style={{ width: '100%', padding: 8 }}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
          </div>
          <button type="submit" style={{ padding: '8px 24px', cursor: 'pointer' }}>
            Submit
          </button>
        </form>
      )}

      <div>
        {filteredTickets.length === 0 ? (
          <p>No tickets yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #ccc' }}>Subject</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #ccc' }}>Customer</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #ccc' }}>Priority</th>
                <th style={{ textAlign: 'left', padding: 8, borderBottom: '2px solid #ccc' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map(ticket => (
                <tr key={ticket.id} onClick={() => navigate(`/tickets/${ticket.id}`)} style={{ cursor: 'pointer' }}>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{ticket.subject}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{ticket.customerEmail}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{ticket.priority}</td>
                  <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{ticket.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
