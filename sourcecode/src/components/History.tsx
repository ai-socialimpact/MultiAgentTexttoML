import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useProject } from '../contexts/ProjectContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { History as HistoryIcon } from 'lucide-react';

export interface HistoryItem {
  id?: string;
  projectId: string;
  userId: string;
  userQuery: string;
  refinedUserQuery?: string;
  generatedCode?: string[];
  executionStatus: string;
  narrative?: string;
  timestamp: string;
}

export const History: React.FC = () => {
  const { user } = useAuth();
  const { currentProject } = useProject();
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    if (!user || !currentProject) return;
    
    const q = query(
      collection(db, 'history'),
      where('projectId', '==', currentProject.projectId),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const hist: HistoryItem[] = [];
      snapshot.forEach((doc) => {
        hist.push({ id: doc.id, ...doc.data() } as HistoryItem);
      });
      hist.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setHistory(hist);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'history');
    });

    return () => unsubscribe();
  }, [user, currentProject]);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <HistoryIcon className="w-5 h-5 text-blue-500" />
        Query History
      </h2>
      {history.length === 0 ? (
        <p className="text-gray-500">No history yet.</p>
      ) : (
        <div className="space-y-4">
          {history.map((item) => (
            <div key={item.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <p className="font-medium text-gray-900 mb-2">{item.userQuery}</p>
              <p className="text-sm text-gray-600 mb-2"><strong>Refined:</strong> {item.refinedUserQuery}</p>
              <p className="text-sm text-gray-700 mb-2">{item.narrative}</p>
              <p className="text-xs text-gray-400">{new Date(item.timestamp).toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
