document.addEventListener('DOMContentLoaded', function() {
    // Initialize tooltips
    var tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
    var tooltipList = tooltipTriggerList.map(function (tooltipTriggerEl) {
      return new bootstrap.Tooltip(tooltipTriggerEl);
    });
    
    // Add active class to current navigation item
    const currentLocation = location.pathname;
    const navItems = document.querySelectorAll('.nav-link');
    navItems.forEach(item => {
      if(item.getAttribute('href') === currentLocation) {
        item.classList.add('active');
      }
    });
    
    // Handle tech delete requests via AJAX
    const deleteTechButtons = document.querySelectorAll('.delete-tech-btn');
    deleteTechButtons.forEach(button => {
      button.addEventListener('click', async function(e) {
        e.preventDefault();
        
        if (!confirm('Are you sure you want to delete this request? This action cannot be undone.')) {
          return;
        }
        
        const requestId = this.getAttribute('data-request-id');
        
        try {
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
          
          const response = await fetch(`/requests/${requestId}/delete`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            }
          });
          
          if (response.ok) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(button.closest('.modal'));
            modal.hide();
            
            // Remove the row from the table
            const row = Array.from(document.querySelectorAll('.btn[data-bs-target="#viewRequestModal' + requestId + '"]')).map(el => el.closest('tr'))[0];
            if (row) {
              row.remove();
            }
            
            // Show success message
            alert('Request deleted successfully.');
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-trash me-1"></i> Delete';
          }
        } catch (error) {
          console.error('Error deleting request:', error);
          alert('An error occurred while deleting the request. Please try again.');
          button.disabled = false;
          button.innerHTML = '<i class="fas fa-trash me-1"></i> Delete';
        }
      });
    });
    
    // Tech edit forms
    const techEditForms = document.querySelectorAll('.tech-edit-form');
    techEditForms.forEach(form => {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const formData = new FormData(form);
        const submitButton = form.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.innerHTML;
        
        try {
          submitButton.disabled = true;
          submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
          
          const response = await fetch(form.action, {
            method: 'POST',
            headers: {
              'Accept': 'application/json'
            },
            body: new URLSearchParams(formData)
          });
          
          if (response.ok) {
            // Close the modal
            const modal = bootstrap.Modal.getInstance(form.closest('.modal'));
            modal.hide();
            
            // Show success message
            alert('Request updated successfully.');
            
            // Reload the page to reflect changes
            window.location.reload();
          } else {
            const error = await response.json();
            alert(`Error: ${error.message || 'Something went wrong'}`);
            submitButton.disabled = false;
            submitButton.innerHTML = originalButtonText;
          }
        } catch (error) {
          console.error('Error updating request:', error);
          alert('An error occurred while updating the request. Please try again.');
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
        }
      });
    });
  });