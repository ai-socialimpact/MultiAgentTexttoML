import React, { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { agents } from '../lib/agents';
import { db } from '../firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Search, Loader2, Zap, Code, FileText, MessageSquare, ChevronRight } from 'lucide-react';

export const FastTrack: React.FC = () => {
  const { currentProject } = useProject();
  const { user } = useAuth();
  const { models } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentProject || !user || !searchQuery.trim()) return;

    setIsSearching(true);
    try {
      // 1. Fetch all favourites for this project/user
      const q = query(
        collection(db, 'favourites'),
        where('projectId', '==', currentProject.projectId),
        where('userId', '==', user.uid)
      );
      const snapshot = await getDocs(q);
      const favs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (favs.length === 0) {
        alert("No favourite queries found to search from.");
        return;
      }

      // 2. Use SimilaritySearchAgent to find top 3
      const searchResult = await agents.similaritySearch(searchQuery, favs, models.strategyCreator);
      
      // 3. Map back to full favourite objects
      const matches = searchResult.matches
        .map((match: any) => favs.find(f => f.id === match.id))
        .filter(Boolean);

      setResults(matches);
    } catch (error) {
      console.error("Error searching for similar questions:", error);
      alert("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Search Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="inline-flex p-3 bg-blue-50 rounded-full text-blue-600 mb-2">
            <Zap className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Fast Track Search</h2>
          <p className="text-gray-600">
            Search for similar questions in your Favourites to quickly reuse analysis plans and code.
          </p>
          
          <form onSubmit={handleSearch} className="relative mt-6">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Type a new query or refined query..."
              className="w-full pl-12 pr-4 py-4 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-6 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Search'}
            </button>
          </form>
        </div>
      </div>

      {/* Results List */}
      <div className="space-y-6">
        {results.length > 0 ? (
          results.map((res, idx) => (
            <div key={res.id || idx} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center font-bold text-sm">
                    #{idx + 1}
                  </div>
                  <h3 className="font-bold text-gray-900">Similar Match Found</h3>
                </div>
                <span className="text-xs font-mono text-gray-400">ID: {res.id?.slice(0, 8)}</span>
              </div>
              
              <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Queries */}
                <div className="space-y-6">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" />
                      Original User Query
                    </h4>
                    <p className="text-gray-900 font-medium">{res.userQuery}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <ChevronRight className="w-3 h-3" />
                      Refined Query
                    </h4>
                    <p className="text-blue-700 bg-blue-50 p-3 rounded-lg border border-blue-100 italic">
                      {res.refinedQuery}
                    </p>
                  </div>
                </div>

                {/* Right Column: Assets */}
                <div className="space-y-6">
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <FileText className="w-3 h-3" />
                      Analysis Plan
                    </h4>
                    <div className="space-y-2">
                      {res.analysisPlan?.map((step: string, i: number) => (
                        <div key={i} className="flex gap-2 text-xs text-gray-600">
                          <span className="text-blue-500 font-bold">{i + 1}.</span>
                          {step}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Code className="w-3 h-3" />
                      Successfully Executed Code
                    </h4>
                    <div className="bg-gray-900 rounded-lg p-4 max-h-48 overflow-auto">
                      <pre className="text-[10px] text-green-400 font-mono">
                        {res.generatedCode?.[0] || '// No code available'}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : searchQuery && !isSearching ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <p className="text-gray-500">No similar questions found in your favourites.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
};
