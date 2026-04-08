interface ContextWindow {
  id: string;
  content: string;
  priority: number;
  timestamp: number;
  size: number;
  metadata?: Record<string, any>;
}

interface WindowAnalysis {
  totalSize: number;
  tokenCount: number;
  averagePriority: number;
  windowCount: number;
  overflow: boolean;
  overflowAmount: number;
  recommendations: string[];
  optimalWindowCount: number;
}

interface BudgetState {
  vesselId: string;
  totalBudget: number;
  usedBudget: number;
  remainingBudget: number;
  resetAt: number;
  windows: ContextWindow[];
}

interface EvictionRequest {
  vesselId: string;
  strategy: 'priority' | 'fifo' | 'size' | 'hybrid';
  targetSize?: number;
  preserveIds?: string[];
}

interface EvictionResult {
  evicted: ContextWindow[];
  retained: ContextWindow[];
  freedSize: number;
  newTotalSize: number;
}

class ContextLimits {
  private static readonly MAX_WINDOW_SIZE = 4000;
  private static readonly OPTIMAL_WINDOW_COUNT = 10;
  private static readonly BUDGET_RESET_HOURS = 24;
  
  private budgets: Map<string, BudgetState> = new Map();
  
  analyzeWindows(windows: ContextWindow[]): WindowAnalysis {
    const totalSize = windows.reduce((sum, w) => sum + w.size, 0);
    const tokenCount = windows.reduce((sum, w) => sum + this.estimateTokens(w.content), 0);
    const averagePriority = windows.length > 0 
      ? windows.reduce((sum, w) => sum + w.priority, 0) / windows.length 
      : 0;
    
    const overflow = totalSize > ContextLimits.MAX_WINDOW_SIZE;
    const overflowAmount = overflow ? totalSize - ContextLimits.MAX_WINDOW_SIZE : 0;
    
    const recommendations: string[] = [];
    if (overflow) {
      recommendations.push(`Reduce context by ${overflowAmount} units`);
    }
    if (windows.length > ContextLimits.OPTIMAL_WINDOW_COUNT) {
      recommendations.push(`Consider consolidating ${windows.length - ContextLimits.OPTIMAL_WINDOW_COUNT} windows`);
    }
    if (averagePriority < 0.5) {
      recommendations.push("Increase priority scoring for important content");
    }
    
    return {
      totalSize,
      tokenCount,
      averagePriority,
      windowCount: windows.length,
      overflow,
      overflowAmount,
      recommendations,
      optimalWindowCount: ContextLimits.OPTIMAL_WINDOW_COUNT
    };
  }
  
  evictWindows(request: EvictionRequest): EvictionResult {
    const budget = this.budgets.get(request.vesselId);
    if (!budget) {
      throw new Error(`No budget found for vessel: ${request.vesselId}`);
    }
    
    let windows = [...budget.windows];
    
    if (request.preserveIds) {
      windows = windows.filter(w => !request.preserveIds!.includes(w.id));
    }
    
    let evicted: ContextWindow[] = [];
    let retained: ContextWindow[] = [];
    
    switch (request.strategy) {
      case 'priority':
        windows.sort((a, b) => a.priority - b.priority);
        break;
      case 'fifo':
        windows.sort((a, b) => a.timestamp - b.timestamp);
        break;
      case 'size':
        windows.sort((a, b) => b.size - a.size);
        break;
      case 'hybrid':
        windows.sort((a, b) => {
          const priorityScore = a.priority - b.priority;
          const recencyScore = (b.timestamp - a.timestamp) / 1000000;
          return priorityScore + recencyScore;
        });
        break;
    }
    
    const targetSize = request.targetSize || ContextLimits.MAX_WINDOW_SIZE;
    let currentSize = budget.usedBudget;
    
    for (const window of windows) {
      if (currentSize <= targetSize) {
        retained.push(window);
      } else {
        evicted.push(window);
        currentSize -= window.size;
      }
    }
    
    const freedSize = budget.usedBudget - currentSize;
    
    budget.windows = retained;
    budget.usedBudget = currentSize;
    budget.remainingBudget = budget.totalBudget - currentSize;
    
    return {
      evicted,
      retained,
      freedSize,
      newTotalSize: currentSize
    };
  }
  
  getBudget(vesselId: string): BudgetState {
    let budget = this.budgets.get(vesselId);
    
    if (!budget || this.isBudgetExpired(budget)) {
      budget = this.createBudget(vesselId);
      this.budgets.set(vesselId, budget);
    }
    
    return budget;
  }
  
  updateBudget(vesselId: string, windows: ContextWindow[]): BudgetState {
    const budget = this.getBudget(vesselId);
    const totalSize = windows.reduce((sum, w) => sum + w.size, 0);
    
    if (totalSize > budget.totalBudget) {
      throw new Error(`Total size ${totalSize} exceeds budget ${budget.totalBudget}`);
    }
    
    budget.windows = windows;
    budget.usedBudget = totalSize;
    budget.remainingBudget = budget.totalBudget - totalSize;
    
    return budget;
  }
  
  private createBudget(vesselId: string): BudgetState {
    return {
      vesselId,
      totalBudget: ContextLimits.MAX_WINDOW_SIZE,
      usedBudget: 0,
      remainingBudget: ContextLimits.MAX_WINDOW_SIZE,
      resetAt: Date.now() + (ContextLimits.BUDGET_RESET_HOURS * 60 * 60 * 1000),
      windows: []
    };
  }
  
  private isBudgetExpired(budget: BudgetState): boolean {
    return Date.now() > budget.resetAt;
  }
  
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

const contextLimits = new ContextLimits();

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    
    if (url.pathname === "/api/analyze" && request.method === "POST") {
      try {
        const windows: ContextWindow[] = await request.json();
        const analysis = contextLimits.analyzeWindows(windows);
        
        return new Response(JSON.stringify(analysis), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: "Invalid request" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    
    if (url.pathname.startsWith("/api/budget/") && request.method === "GET") {
      const vesselId = url.pathname.split("/").pop();
      if (!vesselId) {
        return new Response(JSON.stringify({ error: "Missing vessel ID" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      const budget = contextLimits.getBudget(vesselId);
      return new Response(JSON.stringify(budget), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    if (url.pathname === "/api/evict" && request.method === "POST") {
      try {
        const evictionRequest: EvictionRequest = await request.json();
        const result = contextLimits.evictWindows(evictionRequest);
        
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "healthy", timestamp: Date.now() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};
