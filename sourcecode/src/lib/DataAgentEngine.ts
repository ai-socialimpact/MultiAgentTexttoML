export class DataAgentEngine {
  private worker: Worker | null = null;
  private timeoutId: number | null = null;

  constructor() {}

  // Helper to slice data for sniff test
  private getSubset(data: any, size: number = 5): any {
    if (Array.isArray(data)) {
      return data.slice(0, size);
    }
    
    if (typeof data === 'object' && data !== null) {
      const subset: any = {};
      for (const key in data) {
        if (Array.isArray(data[key])) {
          subset[key] = data[key].slice(0, size);
        } else {
          subset[key] = data[key];
        }
      }
      return subset;
    }
    
    return data;
  }

  // Executes code in a sandboxed Web Worker
  private executeInWorker(code: string, data: any, onLog?: (msg: string) => void, timeoutMs: number = 30000): Promise<any> {
    return new Promise((resolve, reject) => {
      this.stop(); // Ensure any existing worker is stopped

      const workerCode = `
        importScripts('https://cdn.jsdelivr.net/npm/danfojs@1.1.2/lib/bundle.min.js');
        importScripts('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.10.0/dist/tf.min.js');

        // Capture console.log
        const originalLog = console.log;
        console.log = function(...args) {
          const msg = args.map(a => {
            try {
              return typeof a === 'object' ? JSON.stringify(a) : String(a);
            } catch (e) {
              return String(a);
            }
          }).join(' ');
          self.postMessage({ type: 'log', message: msg });
          originalLog.apply(console, args);
        };

        self.onmessage = async function(e) {
          const { data, code } = e.data;
          try {
            // Create a sandboxed function
            const analysisFn = new Function('data', 'dfd', 'tf', \`
              return (async () => {
                \${code}
              })();
            \`);
            
            const result = await analysisFn(data, self.dfd, self.tf);
            self.postMessage({ type: 'result', success: true, result });
          } catch (error) {
            self.postMessage({ type: 'result', success: false, error: error.message || String(error) });
          }
        };
      `;

      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      
      this.worker = new Worker(workerUrl);

      this.timeoutId = window.setTimeout(() => {
        this.stop();
        reject(new Error('Execution timed out'));
      }, timeoutMs);

      this.worker.onmessage = (e) => {
        if (e.data.type === 'log') {
          if (onLog) onLog(e.data.message);
          return;
        }

        if (e.data.type === 'result') {
          if (this.timeoutId) clearTimeout(this.timeoutId);
          if (e.data.success) {
            resolve(e.data.result);
          } else {
            reject(new Error(e.data.error));
          }
          this.stop();
        }
      };

      this.worker.onerror = (error) => {
        if (this.timeoutId) clearTimeout(this.timeoutId);
        reject(new Error(error.message));
        this.stop();
      };

      this.worker.postMessage({ data, code });
    });
  }

  // Main entry point for running analysis
  public async runAnalysis(code: string, fullData: any, onLog?: (msg: string) => void): Promise<any> {
    if (!fullData || (Array.isArray(fullData) && fullData.length === 0) || (typeof fullData === 'object' && Object.keys(fullData).length === 0)) {
      throw new Error("No data available for analysis. Please ensure CSV files are uploaded and parsed correctly.");
    }

    try {
      // 1. Sniff test on subset
      if (onLog) onLog('Running sniff test on subset...');
      const subset = this.getSubset(fullData);
      await this.executeInWorker(code, subset, onLog, 5000); // 5s timeout for sniff test
      
      // 2. Full execution
      if (onLog) onLog('Sniff test passed. Running full analysis...');
      const result = await this.executeInWorker(code, fullData, onLog, 60000); // 60s timeout for full data
      return result;
    } catch (error) {
      if (onLog) onLog(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  public stop() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }
}
