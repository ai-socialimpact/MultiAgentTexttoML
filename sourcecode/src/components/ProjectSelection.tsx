import React, { useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useAuth } from '../contexts/AuthContext';
import { FolderPlus, Folder, LogOut } from 'lucide-react';

export const ProjectSelection: React.FC = () => {
  const { projects, setCurrentProject, createProject, isLoading } = useProject();
  const { logout } = useAuth();
  const [newProjectName, setNewProjectName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setIsCreating(true);
    await createProject(newProjectName.trim());
    setIsCreating(false);
    setNewProjectName('');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Your Projects</h1>
          <button
            onClick={logout}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Create New Project Card */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col justify-center items-center text-center min-h-[200px]">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
              <FolderPlus className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-4">Create New Project</h3>
            <form onSubmit={handleCreate} className="w-full">
              <input
                type="text"
                placeholder="Project Name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md mb-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isCreating}
              />
              <button
                type="submit"
                disabled={!newProjectName.trim() || isCreating}
                className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </form>
          </div>

          {/* Existing Projects */}
          {isLoading ? (
            <div className="col-span-full text-center py-12 text-gray-500">Loading projects...</div>
          ) : (
            projects.map((project) => (
              <button
                key={project.projectId}
                onClick={() => setCurrentProject(project)}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-left hover:border-blue-500 hover:shadow-md transition-all flex flex-col min-h-[200px]"
              >
                <div className="w-12 h-12 bg-gray-50 text-gray-600 rounded-full flex items-center justify-center mb-4">
                  <Folder className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2 line-clamp-2">{project.name}</h3>
                <p className="text-sm text-gray-500 mt-auto">
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </p>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
