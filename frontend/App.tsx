import React from 'react';
import { Header } from './components/Header';
import { TradingChart } from './components/TradingChart';
import { OrderForm } from './components/OrderForm';
import { OrderBook } from './components/OrderBook';
import { RecentTrades } from './components/RecentTrades';
import { Positions } from './components/Positions';
import { ExchangeStoreProvider } from './store/exchangeStore';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  public state: { hasError: boolean, error: Error | null };
  public props: { children: React.ReactNode };

  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-red-500 bg-gray-900 h-screen flex flex-col items-center justify-center">
          <h1 className="text-2xl font-bold mb-4">Something went wrong.</h1>
          <pre className="bg-black p-4 rounded overflow-auto max-w-full">
            {this.state.error?.toString()}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <ExchangeStoreProvider>
        <div className="h-screen bg-[#05050A] text-gray-300 font-sans selection:bg-nebula-violet selection:text-white flex flex-col overflow-hidden">
          <Header />

          <main className="flex-1 p-2 overflow-hidden">
            <div className="grid grid-cols-12 gap-2 h-full">

              {/* Left Column: Chart & Positions (58%) */}
              <div className="col-span-12 lg:col-span-7 flex flex-col gap-2 h-full min-h-0">
                {/* Chart Section */}
                <div className="flex-[3] min-h-0">
                  <TradingChart />
                </div>

                {/* Bottom Panel (Positions) */}
                <div className="flex-[2] min-h-0">
                  <Positions />
                </div>
              </div>

              {/* Middle Column: OrderBook & Trades (17%) */}
              <div className="col-span-12 md:col-span-6 lg:col-span-2 flex flex-col gap-2 h-full min-h-0">
                <div className="flex-[3] min-h-0">
                  <OrderBook />
                </div>
                <div className="flex-[2] min-h-0">
                  <RecentTrades />
                </div>
              </div>

              {/* Right Column: Trade Panel (25%) */}
              <div className="col-span-12 md:col-span-6 lg:col-span-3 h-full min-h-0">
                <OrderForm />
              </div>

            </div>
          </main>
        </div>
      </ExchangeStoreProvider>
    </ErrorBoundary>
  );
};

export default App;
