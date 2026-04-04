import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })

  useEffect(() => {
    if (user) {
      localStorage.setItem('user', JSON.stringify(user))
    } else {
      localStorage.removeItem('user')
    }
  }, [user])

  function signUp(name, email, password) {
    const users = JSON.parse(localStorage.getItem('users') || '[]')
    if (users.find(u => u.email === email)) {
      throw new Error('Email already registered')
    }
    const newUser = { name, email, password }
    users.push(newUser)
    localStorage.setItem('users', JSON.stringify(users))
    setUser({ name, email })
  }

  function signIn(email, password) {
    const users = JSON.parse(localStorage.getItem('users') || '[]')
    const found = users.find(u => u.email === email && u.password === password)
    if (!found) {
      throw new Error('Invalid email or password')
    }
    setUser({ name: found.name, email: found.email })
  }

  function signOut() {
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
