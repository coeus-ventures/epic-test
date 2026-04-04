import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const { signIn } = useAuth()
  const navigate = useNavigate()

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    try {
      signIn(email, password)
      navigate('/tickets')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div style={{ maxWidth: 400, margin: '80px auto', padding: 24 }}>
      <h1>Sign In</h1>
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            style={{ display: 'block', width: '100%', padding: 8, marginTop: 4 }}
          />
        </div>
        <button type="submit" style={{ padding: '8px 24px', cursor: 'pointer' }}>
          Sign In
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        Don't have an account? <Link to="/sign-up">Sign Up</Link>
      </p>
    </div>
  )
}
