import React, { createContext, useContext, useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc, updateDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

export interface Project {
  projectId: string;
  userId: string;
  name: string;
  createdAt: string;
  schemaDescription?: string;
  fewShotDescription?: string;
  classifierGuidelines?: string;
  fewShotExamples?: string;
  dataFiles?: { name: string, url: string }[];
}

interface ProjectContextType {
  projects: Project[];
  currentProject: Project | null;
  setCurrentProject: (project: Project | null) => void;
  createProject: (name: string) => Promise<void>;
  updateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
  isLoading: boolean;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (!context) throw new Error('useProject must be used within a ProjectProvider');
  return context;
};

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthReady } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAuthReady) return;
    
    if (!user) {
      setProjects([]);
      setCurrentProject(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const q = query(collection(db, 'projects'), where('userId', '==', user.uid));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projs: Project[] = [];
      snapshot.forEach((doc) => {
        projs.push(doc.data() as Project);
      });
      setProjects(projs);
      
      setCurrentProject(prev => {
        if (prev) {
          const updated = projs.find(p => p.projectId === prev.projectId);
          return updated || null;
        }
        return null;
      });
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  const createProject = async (name: string) => {
    if (!user) return;
    try {
      const projectId = uuidv4();
      const newProject: Project = {
        projectId,
        userId: user.uid,
        name,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'projects', projectId), newProject);
      setCurrentProject(newProject);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    }
  };

  const updateProject = async (projectId: string, updates: Partial<Project>) => {
    try {
      await updateDoc(doc(db, 'projects', projectId), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}`);
    }
  };

  return (
    <ProjectContext.Provider value={{ projects, currentProject, setCurrentProject, createProject, updateProject, isLoading }}>
      {children}
    </ProjectContext.Provider>
  );
};
