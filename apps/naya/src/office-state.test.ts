import { describe, expect, it } from 'vitest'
import { officeBadge, officeStateBadge } from './office-state.ts'

describe('officeBadge', () => {
  it('maps only declared runtime availability without inferring activity', () => {
    expect(officeBadge({ availability: 'available', data: 'Running' })).toEqual({ label: 'Berjalan', tone: 'good' })
    expect(officeBadge({ availability: 'available', data: 'Unknown' })).toEqual({ label: 'Tidak diketahui', tone: 'unknown' })
    expect(officeBadge({ availability: 'unavailable', data: 'Unknown' })).toEqual({ label: 'Tidak tersedia', tone: 'muted' })
    expect(officeBadge({ availability: 'available', data: '1.2.3' }, 'version')).toEqual({ label: 'Versi tersedia', tone: 'good' })
    expect(officeBadge({ availability: 'available', data: 'Unknown' }, 'version')).toEqual({ label: 'Tidak diketahui', tone: 'unknown' })
  })
})

describe('officeStateBadge', () => {
  it('renders only approved Office work states', () => {
    expect(officeStateBadge('Working')).toEqual({ label: 'Bekerja', tone: 'good' })
    expect(officeStateBadge('Reviewing')).toEqual({ label: 'Mereview', tone: 'good' })
    expect(officeStateBadge('Offline')).toEqual({ label: 'Offline', tone: 'muted' })
    expect(officeStateBadge('Unknown')).toEqual({ label: 'Tidak diketahui', tone: 'unknown' })
  })
})
