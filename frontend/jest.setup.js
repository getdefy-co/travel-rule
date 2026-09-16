import '@testing-library/jest-dom'
import { beforeEach, jest } from '@jest/globals'
import './src/i18n/config'
import { installBrowserMocks, resetBrowserMocks } from './__tests__/helpers/browser-mocks'

jest.setTimeout(20000)

if (typeof window !== 'undefined') {
  installBrowserMocks()
}

beforeEach(() => {
  if (typeof window !== 'undefined') {
    resetBrowserMocks()
  }
})
