import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import SignUp from './pages/SignUp'
import SignIn from './pages/SignIn'
import Surveys from './pages/Surveys'
import SurveyDetail from './pages/SurveyDetail'
import Analytics from './pages/Analytics'

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/sign-in" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/surveys" element={<ProtectedRoute><Surveys /></ProtectedRoute>} />
      <Route path="/surveys/:id" element={<ProtectedRoute><SurveyDetail /></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
      <Route path="/" element={<Navigate to="/sign-in" replace />} />
    </Routes>
  )
}
