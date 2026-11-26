/**
 * Admin Login & First-Time Setup Modal (`dashboard-ui/src/components/LoginModal.tsx`)
 *
 * Automatically switches between First-Time Admin Setup (`POST /api/auth/setup`) when no
 * `admin_password_hash` exists in `secrets.yaml` and standard Admin Sign-In (`POST /api/auth/login`).
 */
import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2, Lock, ShieldCheck, X } from 'lucide-react';

interface LoginModalProps {
  open: boolean;
  setupRequired: boolean;
  onClose: () => void;
  onSuccess: (username: string) => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({
  open,
  setupRequired,
  onClose,
  onSuccess,
}) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setConfirmPassword('');
    setError(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (setupRequired) {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = setupRequired ? '/api/auth/setup' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() || 'admin', password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Authentication failed.');
        return;
      }
      onSuccess(data.username || username.trim() || 'admin');
    } catch {
      setError('Could not reach live API server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-[#1F2937] bg-[#111827] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#1F2937] px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#F9FAFB]">
            {setupRequired ? (
              <ShieldCheck className="h-4 w-4 text-[#10B981]" />
            ) : (
              <Lock className="h-4 w-4 text-[#06B6D4]" />
            )}
            {setupRequired ? 'First-Time Admin Setup' : 'Admin Login'}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#9CA3AF] hover:bg-[#1F2937] hover:text-[#F9FAFB]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-4">
          <p className="text-[11px] leading-relaxed text-[#9CA3AF]">
            {setupRequired
              ? 'Create an Admin account to unlock Workspace Settings and AI Executive Summary generation. Shared client links remain read-only.'
              : 'Sign in as Admin to edit SLA settings, manage API keys, and generate AI Executive Summaries.'}
          </p>

          {error && (
            <div className="rounded border border-[#EF4444]/40 bg-[#EF4444]/10 px-2.5 py-1.5 text-[11px] text-[#FCA5A5]">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[#9CA3AF]">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
              className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] focus:border-[#06B6D4] focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-[#9CA3AF]">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder={setupRequired ? 'Minimum 6 characters' : 'Enter admin password'}
              className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
            />
          </div>

          {setupRequired && (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#9CA3AF]">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Re-enter password"
                className="w-full rounded-md border border-[#1F2937] bg-[#0B0F19] px-2.5 py-1.5 text-xs text-[#F9FAFB] placeholder:text-[#6B7280] focus:border-[#06B6D4] focus:outline-none"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[#1F2937] bg-[#0B0F19] px-3 py-1.5 text-xs text-[#9CA3AF] hover:text-[#F9FAFB]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#06B6D4] px-3.5 py-1.5 text-xs font-semibold text-[#0B0F19] hover:bg-[#22D3EE] disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              {setupRequired ? 'Create Admin & Sign In' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
